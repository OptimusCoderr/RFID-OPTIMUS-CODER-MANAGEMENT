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
  label: z.string().max(200).nullable().optional(),
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
