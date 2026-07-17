import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { computeSessionState } from "./attendanceSessionService.js";

const ATTENDANCE_INCLUDE = {
  card: { select: { id: true, uid: true, label: true } },
  holder: { select: { id: true, fullName: true, department: true, employeeId: true } },
  zone: { select: { id: true, name: true } },
  encoder: { select: { id: true, name: true } },
} as const;

// A tap alternates CHECK_IN/CHECK_OUT for a given holder, tracked
// independently per zone (a student's lecture-room state doesn't affect
// their library state) — so no separate "start session" step is needed,
// and a missed tap just leaves that scope's next tap correctly reversed.
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
  if (card.status === "BLOCKED" || card.status === "LOST" || card.status === "RETIRED" || card.status === "EXPIRED") {
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

  // An encoder with no saved session is unrestricted, same as every other
  // opt-in restriction in this app (CardEncoderAllocation, CompanyModule).
  // Checked live via computeSessionState, not a stored flag, so a manual
  // Start/Stop click takes effect on the very next tap.
  if (params.encoderId) {
    const session = await prisma.attendanceSession.findUnique({ where: { encoderId: params.encoderId } });
    if (session) {
      const state = computeSessionState(session);
      if (!state.isOpen) {
        throw ApiError.badRequest("Attendance is not currently open for this encoder");
      }
    }
  }

  const zoneId = params.zoneId ?? null;
  const last = await prisma.attendanceRecord.findFirst({
    where: { companyId: params.companyId, holderId: card.holderId, zoneId },
    orderBy: { recordedAt: "desc" },
  });
  const type = last?.type === "CHECK_IN" ? "CHECK_OUT" : "CHECK_IN";

  return prisma.attendanceRecord.create({
    data: {
      companyId: params.companyId,
      cardId: card.id,
      holderId: card.holderId,
      zoneId: zoneId ?? undefined,
      encoderId: params.encoderId ?? undefined,
      type,
    },
    include: ATTENDANCE_INCLUDE,
  });
}

export { ATTENDANCE_INCLUDE };
