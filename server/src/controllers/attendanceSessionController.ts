import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import { computeSessionState } from "../services/attendanceSessionService.js";
import { isValidDateRange } from "../validators/attendanceSession.js";
import { runSerializable } from "../utils/serializableRetry.js";

const SESSION_INCLUDE = {
  encoder: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
} as const;

function withState<
  T extends {
    daysOfWeek: number[];
    startTime: string | null;
    endTime: string | null;
    startDate: string | null;
    endDate: string | null;
    manualOverride: "NONE" | "FORCE_OPEN" | "FORCE_CLOSED";
  }
>(session: T) {
  return { ...session, state: computeSessionState(session) };
}

async function loadEncoder(req: Request, encoderId: string) {
  const encoder = await prisma.encoder.findUnique({ where: { id: encoderId } });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);
  return encoder;
}

async function loadSession(req: Request, id: string) {
  const session = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!session) throw ApiError.notFound("Schedule not found");
  assertCompanyAccess(req, session.companyId);
  return session;
}

async function assertZoneBelongsToCompany(zoneId: string | null | undefined, companyId: string) {
  if (!zoneId) return;
  const zone = await prisma.accessZone.findUnique({ where: { id: zoneId } });
  if (!zone || zone.companyId !== companyId) {
    throw ApiError.badRequest("Zone does not belong to this company");
  }
}

export const listAttendanceSessions = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const { encoderId } = req.query as { encoderId?: string };
  const sessions = await prisma.attendanceSession.findMany({
    where: { ...(companyId ? { companyId } : {}), ...(encoderId ? { encoderId } : {}) },
    include: SESSION_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  res.json(sessions.map(withState));
});

export const createAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const { encoderId, zoneId, label, description, daysOfWeek, startTime, endTime, startDate, endDate, mode } = req.body;
  const encoder = await loadEncoder(req, encoderId);
  await assertZoneBelongsToCompany(zoneId, encoder.companyId);

  const session = await prisma.attendanceSession.create({
    data: {
      companyId: encoder.companyId,
      encoderId: encoder.id,
      zoneId: zoneId ?? undefined,
      label,
      description: description ?? undefined,
      daysOfWeek,
      startTime: startTime ?? undefined,
      endTime: endTime ?? undefined,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      mode,
    },
    include: SESSION_INCLUDE,
  });

  res.status(201).json(withState(session));
});

export const updateAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSession(req, req.params.id);
  const { encoderId, zoneId, label, description, daysOfWeek, startTime, endTime, startDate, endDate, mode } = req.body;

  // Moving a schedule to a different encoder ("this course changed rooms")
  // — optional, and re-validated against the same company either way.
  const companyId = encoderId ? (await loadEncoder(req, encoderId)).companyId : existing.companyId;
  if (zoneId !== undefined) await assertZoneBelongsToCompany(zoneId, companyId);

  // The request body's own startDate/endDate refine only compares fields
  // present in THIS request — a PATCH touching just one side can't see
  // whether it's about to conflict with the other side's already-stored
  // value. Comparing the merged (existing + incoming) pair here catches
  // that, e.g. two separate PATCHes that each look fine in isolation but
  // together leave startDate after endDate (which computeSessionState would
  // then read as "permanently closed" with no error ever surfaced).
  const mergedStartDate = startDate === undefined ? existing.startDate : startDate;
  const mergedEndDate = endDate === undefined ? existing.endDate : endDate;
  if (!isValidDateRange(mergedStartDate, mergedEndDate)) {
    throw ApiError.badRequest("endDate must be on or after startDate");
  }

  const session = await prisma.attendanceSession.update({
    where: { id: existing.id },
    data: {
      encoderId: encoderId ?? undefined,
      zoneId: zoneId === undefined ? undefined : zoneId,
      label: label ?? undefined,
      description: description === undefined ? undefined : description,
      daysOfWeek: daysOfWeek ?? undefined,
      startTime: startTime === undefined ? undefined : startTime,
      endTime: endTime === undefined ? undefined : endTime,
      startDate: startDate === undefined ? undefined : startDate,
      endDate: endDate === undefined ? undefined : endDate,
      mode: mode ?? undefined,
    },
    include: SESSION_INCLUDE,
  });

  res.json(withState(session));
});

export const setAttendanceSessionOverride = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSession(req, req.params.id);
  const { manualOverride } = req.body;

  const session = await prisma.attendanceSession.update({
    where: { id: existing.id },
    data: { manualOverride },
    include: SESSION_INCLUDE,
  });

  res.json(withState(session));
});

export const deleteAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSession(req, req.params.id);
  await prisma.attendanceSession.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// A "session occurrence" is one specific meeting of a recurring schedule
// (this Monday's class vs. next Monday's) — see recordAttendance's
// auto-open-or-reuse logic in attendanceService.ts, which is what normally
// creates these. The three actions below give an operator manual control
// over that lifecycle: Close ends the current meeting early (so DAILY_CHECK_IN
// stops treating the room as "already in session" and the very next tap
// starts a fresh occurrence automatically); Create does the same but also
// opens the new occurrence right away instead of waiting for the next tap;
// Reopen un-closes a past occurrence so late taps attach to the meeting they
// actually belong to instead of starting a new one.
function serializeOccurrence(o: { id: string; attendanceSessionId: string; openedAt: Date; closedAt: Date | null }) {
  return {
    id: o.id,
    attendanceSessionId: o.attendanceSessionId,
    openedAt: o.openedAt,
    closedAt: o.closedAt,
    isOpen: o.closedAt === null,
  };
}

export const listSessionOccurrences = asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req, req.params.id);
  const occurrences = await prisma.sessionOccurrence.findMany({
    where: { attendanceSessionId: session.id },
    orderBy: { openedAt: "desc" },
    take: 100,
    include: { _count: { select: { records: true } } },
  });
  res.json(
    occurrences.map((o) => ({ ...serializeOccurrence(o), recordCount: o._count.records }))
  );
});

// create/reopen below share the "at most one open occurrence per schedule"
// invariant with recordAttendance's own occurrence handling
// (attendanceService.ts) — run under the same Serializable isolation +
// retry so an operator clicking one of these at the same moment as a real
// tap can't leave two occurrences simultaneously open (Postgres's
// serializability guarantee only holds among transactions that are all
// Serializable, so mixing isolation levels here would silently reopen that
// race).
export const createSessionOccurrence = asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req, req.params.id);
  const occurrence = await runSerializable(async (tx) => {
    await tx.sessionOccurrence.updateMany({
      where: { attendanceSessionId: session.id, closedAt: null },
      data: { closedAt: new Date() },
    });
    return tx.sessionOccurrence.create({
      data: { companyId: session.companyId, attendanceSessionId: session.id },
    });
  });
  res.status(201).json(serializeOccurrence(occurrence));
});

// Unlike its siblings, this one never races against recordAttendance's own
// occurrence handling in a way that matters: it only ever touches an
// occurrence that's already open, and closing an already-closed one twice
// is harmless (idempotent). It's also the rarest of the three — an operator
// manually ending a meeting early — so it isn't worth Serializable
// isolation's retry/backoff overhead the other two need.
export const closeSessionOccurrence = asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req, req.params.id);
  const open = await prisma.sessionOccurrence.findFirst({
    where: { attendanceSessionId: session.id, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
  if (!open) {
    throw ApiError.badRequest("This schedule has no open session to close");
  }
  const closed = await prisma.sessionOccurrence.update({
    where: { id: open.id },
    data: { closedAt: new Date() },
  });
  res.json(serializeOccurrence(closed));
});

export const reopenSessionOccurrence = asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req, req.params.id);
  const reopened = await runSerializable(async (tx) => {
    const target = await tx.sessionOccurrence.findUnique({ where: { id: req.params.occurrenceId } });
    if (!target || target.attendanceSessionId !== session.id) {
      throw ApiError.notFound("Session occurrence not found");
    }
    // At most one open occurrence per schedule — close any other open
    // one (e.g. a newer one auto-created since) before reopening this one.
    await tx.sessionOccurrence.updateMany({
      where: { attendanceSessionId: session.id, closedAt: null, id: { not: target.id } },
      data: { closedAt: new Date() },
    });
    return tx.sessionOccurrence.update({ where: { id: target.id }, data: { closedAt: null } });
  });
  res.json(serializeOccurrence(reopened));
});
