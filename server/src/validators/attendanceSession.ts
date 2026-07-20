import { z } from "zod";

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected 24-hour HH:mm time");

// Required — the only thing that tells two saved schedules apart in the
// list on the Attendance page (e.g. "CS101 Lecture" vs "Front Desk Shift"),
// so a blank one would defeat the point of that table. One encoder can have
// many of these — see the AttendanceSession model comment.
const labelSchema = z.string().trim().min(1, "A label is required").max(200);

// FREE = unlimited alternating check-in/check-out (the original behavior).
// See AttendanceMode in schema.prisma and nextAttendanceType in
// attendanceSessionService.ts for what the other modes reject.
const modeSchema = z.enum(["FREE", "CHECK_IN_ONLY", "CHECK_OUT_ONLY", "ONCE", "DAILY_CHECK_IN"]);

export const createAttendanceSessionBody = z.object({
  companyId: z.string().uuid().optional(),
  encoderId: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  label: labelSchema,
  description: z.string().max(1000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startTime: timeString.nullable().optional(),
  endTime: timeString.nullable().optional(),
  mode: modeSchema.default("FREE"),
});

// A partial update — every field optional except that a label, if given at
// all, still can't be blanked out.
export const updateAttendanceSessionBody = z.object({
  encoderId: z.string().uuid().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  label: labelSchema.optional(),
  description: z.string().max(1000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: timeString.nullable().optional(),
  endTime: timeString.nullable().optional(),
  mode: modeSchema.optional(),
});

export const setOverrideBody = z.object({
  manualOverride: z.enum(["NONE", "FORCE_OPEN", "FORCE_CLOSED"]),
});

export const attendanceSessionListQuery = z.object({
  companyId: z.string().uuid().optional(),
  encoderId: z.string().uuid().optional(),
});

export const sessionOccurrenceParams = z.object({
  id: z.string().uuid(),
  occurrenceId: z.string().uuid(),
});
