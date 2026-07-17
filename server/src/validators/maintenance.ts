import { z } from "zod";

export const openMaintenanceBody = z.object({
  companyId: z.string().uuid().optional(),
  cardId: z.string().uuid(),
  description: z.string().min(1).max(1000),
  notes: z.string().max(2000).optional(),
});

export const updateMaintenanceBody = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
  notes: z.string().max(2000).optional(),
});

export const maintenanceListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.string().uuid().optional(),
  cardId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
});
