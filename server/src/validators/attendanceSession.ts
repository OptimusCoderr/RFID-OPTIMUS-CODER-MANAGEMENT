import { z } from "zod";

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected 24-hour HH:mm time");

export const encoderIdParams = z.object({
  encoderId: z.string().uuid(),
});

export const upsertAttendanceSessionBody = z.object({
  companyId: z.string().uuid().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  // Required — the only thing that tells two saved schedules apart in the
  // list on the Attendance page (e.g. "CS101 Lecture" vs "Front Desk
  // Shift"), so a blank one would defeat the point of that table.
  label: z.string().trim().min(1, "A label is required").max(200),
  description: z.string().max(1000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startTime: timeString.nullable().optional(),
  endTime: timeString.nullable().optional(),
});

export const setOverrideBody = z.object({
  manualOverride: z.enum(["NONE", "FORCE_OPEN", "FORCE_CLOSED"]),
});

export const attendanceSessionListQuery = z.object({
  companyId: z.string().uuid().optional(),
});
