import { z } from "zod";

export const recordAttendanceBody = z.object({
  companyId: z.string().uuid().optional(),
  cardId: z.string().uuid(),
  zoneId: z.string().uuid().optional(),
  encoderId: z.string().uuid().optional(),
});

export const attendanceListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.string().uuid().optional(),
  holderId: z.string().uuid().optional(),
  cardId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  type: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
