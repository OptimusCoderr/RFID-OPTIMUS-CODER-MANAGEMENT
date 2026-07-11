import { z } from "zod";

export const idParams = z.object({
  id: z.string().uuid(),
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.string().uuid().optional(),
});
