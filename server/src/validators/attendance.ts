import { z } from "zod";

export const recordAttendanceBody = z.object({
  companyId: z.string().uuid().optional(),
  cardId: z.string().uuid(),
  zoneId: z.string().uuid().optional(),
  encoderId: z.string().uuid().optional(),
});

export const recordManualAttendanceBody = z.object({
  companyId: z.string().uuid().optional(),
  holderId: z.string().uuid(),
  zoneId: z.string().uuid().optional(),
});

export const attendanceListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.string().uuid().optional(),
  holderId: z.string().uuid().optional(),
  cardId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  encoderId: z.string().uuid().optional(),
  // Exact match against a still-existing schedule (see AttendanceSession).
  sessionId: z.string().uuid().optional(),
  // Text match against the schedule's label as it was at record time —
  // finds records even if that schedule was since renamed or deleted,
  // unlike sessionId above.
  sessionLabel: z.string().min(1).max(200).optional(),
  type: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const updateAttendanceBody = z
  .object({
    type: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
    recordedAt: z.coerce.date().optional(),
  })
  .refine((body) => body.type !== undefined || body.recordedAt !== undefined, {
    message: "At least one of type or recordedAt is required",
  });

// Same filter surface as attendanceListQuery, minus pagination — used to
// scope a bulk clear to exactly what's currently on screen. At least one
// filter is required so a bare DELETE can't wipe a company's entire history
// by accident; note that fully resetting a zone's check-in/check-out state
// (so a new schedule doesn't inherit "already checked in") requires clearing
// by zoneId, not just sessionId, since the toggle itself is scoped by zone.
export const clearAttendanceQuery = z
  .object({
    companyId: z.string().uuid().optional(),
    holderId: z.string().uuid().optional(),
    cardId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
    encoderId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    sessionLabel: z.string().min(1).max(200).optional(),
    type: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (q) => Boolean(q.holderId || q.cardId || q.zoneId || q.encoderId || q.sessionId || q.sessionLabel || q.type || q.from || q.to),
    { message: "At least one filter is required to clear attendance records" }
  );
