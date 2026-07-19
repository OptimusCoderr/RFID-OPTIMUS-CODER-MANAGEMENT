import type { AttendanceMode } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { withSerializableRetry } from "../utils/serializableRetry.js";
import { LIFECYCLE_LOCKED_STATUSES } from "../utils/cardStatus.js";
import { computeEncoderOpenState, nextAttendanceType } from "./attendanceSessionService.js";

const ATTENDANCE_INCLUDE = {
  card: { select: { id: true, uid: true, label: true } },
  holder: { select: { id: true, fullName: true, department: true, employeeId: true } },
  zone: { select: { id: true, name: true } },
  encoder: { select: { id: true, name: true } },
  recordedByUser: { select: { id: true, fullName: true, email: true } },
} as const;

// By default (AttendanceMode FREE) a tap alternates CHECK_IN/CHECK_OUT for a
// given holder, tracked independently per zone (a student's lecture-room
// state doesn't affect their library state) — so no separate "start
// session" step is needed, and a missed tap just leaves that scope's next
// tap correctly reversed. A stricter mode on the encoder's open schedule
// (see nextAttendanceType) can instead cap this at one check-in, one
// check-out, or one full in/out cycle per holder per scope.
export async function recordAttendance(params: {
  companyId: string;
  cardId: string;
  zoneId?: string | null;
  encoderId?: string | null;
}) {
  const card = await prisma.card.findUnique({ where: { id: params.cardId } });
  if (!card || card.companyId !== params.companyId) {
    throw ApiError.badRequest("Card does not belong to this company");
  }
  if (LIFECYCLE_LOCKED_STATUSES.has(card.status)) {
    throw ApiError.badRequest(`This card is ${card.status.toLowerCase()} and cannot be used for attendance`);
  }
  // Checked directly rather than relying on the card's status having been
  // flipped to EXPIRED by the daily cron job (src/jobs/expiringCardsJob.ts)
  // — that job runs once a day, far too coarse for a short-lived Visitors
  // pass to actually stop working when it says it will.
  if (card.expiresAt && card.expiresAt <= new Date()) {
    throw ApiError.badRequest("This card has expired");
  }
  if (!card.holderId) {
    throw ApiError.badRequest("This card isn't assigned to a card holder yet");
  }

  // Without these, a caller could pass another company's zoneId/encoderId
  // here — the card above is company-checked, but these weren't, so a
  // foreign company's private schedule (name, open/closed state) could be
  // read through it, and that foreign zone/encoder would then get stamped
  // onto this company's own AttendanceRecord (and surfaced back to it via
  // listAttendance/exportAttendance).
  if (params.zoneId) {
    const zone = await prisma.accessZone.findUnique({ where: { id: params.zoneId } });
    if (!zone || zone.companyId !== params.companyId) {
      throw ApiError.badRequest("Zone does not belong to this company");
    }
  }
  if (params.encoderId) {
    const encoder = await prisma.encoder.findUnique({ where: { id: params.encoderId } });
    if (!encoder || encoder.companyId !== params.companyId) {
      throw ApiError.badRequest("Encoder does not belong to this company");
    }
  }

  // An encoder with no saved schedules is unrestricted, same as every other
  // opt-in restriction in this app (CardEncoderAllocation, CompanyModule).
  // One encoder can have several independent schedules (a lecture hall
  // hosting multiple courses through the week) — it accepts a tap if ANY of
  // them is currently open. Checked live via computeEncoderOpenState, not a
  // stored flag, so a manual Start/Stop click takes effect on the very next tap.
  //
  // Whichever schedule was the open one is snapshotted onto the record
  // (sessionId + sessionLabel below) so attendance can later be exported or
  // filtered by which class/shift it belongs to — e.g. "CS101" vs "MATH201"
  // taps on the same shared encoder, which are otherwise indistinguishable.
  let sessionId: string | null = null;
  let sessionLabel: string | null = null;
  // FREE reproduces the original unrestricted toggle exactly — it's what
  // applies for any general (no-encoder) tap, and for an encoder whose open
  // schedule doesn't set a stricter mode.
  let mode: AttendanceMode = "FREE";
  if (params.encoderId) {
    const sessions = await prisma.attendanceSession.findMany({ where: { encoderId: params.encoderId } });
    const state = computeEncoderOpenState(sessions);
    if (!state.isOpen) {
      throw ApiError.badRequest("Attendance is not currently open for this encoder");
    }
    if (state.openSessionId) {
      const openSession = sessions.find((s) => s.id === state.openSessionId);
      sessionId = state.openSessionId;
      sessionLabel = openSession?.label ?? null;
      mode = openSession?.mode ?? "FREE";
    }
  }

  const zoneId = params.zoneId ?? null;
  const cardId = card.id;
  const holderId = card.holderId;

  // The read-then-decide-then-write toggle below is a classic check-then-act
  // race: two near-simultaneous taps for the same holder+zone (plausible
  // when several encoders share one general, zoneId:null scope) could both
  // read the same "last" record and both insert CHECK_IN, breaking the
  // alternation. Serializable isolation + retry (see serializableRetry.ts)
  // closes that.
  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const last = await tx.attendanceRecord.findFirst({
          where: { companyId: params.companyId, holderId, zoneId },
          orderBy: { recordedAt: "desc" },
        });
        const decision = nextAttendanceType(mode, last ? { type: last.type } : null);
        if ("rejected" in decision) {
          throw ApiError.badRequest(decision.reason);
        }

        return tx.attendanceRecord.create({
          data: {
            companyId: params.companyId,
            cardId,
            holderId,
            zoneId: zoneId ?? undefined,
            encoderId: params.encoderId ?? undefined,
            sessionId: sessionId ?? undefined,
            sessionLabel: sessionLabel ?? undefined,
            type: decision.type,
          },
          include: ATTENDANCE_INCLUDE,
        });
      },
      { isolationLevel: "Serializable" }
    )
  );
}

// A staff override for when a holder's physical card is lost/unavailable —
// no card is tapped (or required) at all; the holder is picked directly.
// Shares the same companyId+holderId+zoneId toggle scope as recordAttendance
// above, so it interleaves correctly with real taps (e.g. checked in with
// the card yesterday, checking out manually today because the card's now
// lost). Always FREE-mode alternation: without a card there's no encoder
// schedule to read a stricter mode from, and a manual entry is already a
// deliberate human override, not something to further restrict.
export async function recordManualAttendance(params: {
  companyId: string;
  holderId: string;
  zoneId?: string | null;
  recordedByUserId: string;
}) {
  const holder = await prisma.cardHolder.findUnique({ where: { id: params.holderId } });
  if (!holder || holder.companyId !== params.companyId) {
    throw ApiError.badRequest("Card holder does not belong to this company");
  }
  if (params.zoneId) {
    const zone = await prisma.accessZone.findUnique({ where: { id: params.zoneId } });
    if (!zone || zone.companyId !== params.companyId) {
      throw ApiError.badRequest("Zone does not belong to this company");
    }
  }

  const zoneId = params.zoneId ?? null;
  const holderId = params.holderId;

  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const last = await tx.attendanceRecord.findFirst({
          where: { companyId: params.companyId, holderId, zoneId },
          orderBy: { recordedAt: "desc" },
        });
        const decision = nextAttendanceType("FREE", last ? { type: last.type } : null);
        if ("rejected" in decision) {
          throw ApiError.badRequest(decision.reason);
        }

        return tx.attendanceRecord.create({
          data: {
            companyId: params.companyId,
            holderId,
            zoneId: zoneId ?? undefined,
            manualEntry: true,
            recordedByUserId: params.recordedByUserId,
            type: decision.type,
          },
          include: ATTENDANCE_INCLUDE,
        });
      },
      { isolationLevel: "Serializable" }
    )
  );
}

export { ATTENDANCE_INCLUDE };
