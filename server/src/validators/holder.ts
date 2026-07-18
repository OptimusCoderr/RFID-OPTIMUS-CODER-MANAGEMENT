import { z } from "zod";

export const createHolderBody = z.object({
  companyId: z.string().uuid().optional(),
  fullName: z.string().min(2).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  employeeId: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  photoUrl: z.string().url().optional(),
});

export const updateHolderBody = createHolderBody.partial().extend({
  isActive: z.boolean().optional(),
});

export const holderListQuery = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
