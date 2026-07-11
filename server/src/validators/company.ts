import { z } from "zod";

export const createCompanyBody = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens"),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
  logoUrl: z.string().url().optional(),
});

export const updateCompanyBody = createCompanyBody.partial().extend({
  isActive: z.boolean().optional(),
});
