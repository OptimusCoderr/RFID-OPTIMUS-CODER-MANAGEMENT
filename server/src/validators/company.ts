import { z } from "zod";
import { CompanyIndustry, CompanyModule } from "@prisma/client";

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
  // Sets enabledModules to that industry's defaults unless enabledModules is
  // also passed explicitly. Omit both for an unrestricted company (every
  // module available) — see Company.enabledModules in schema.prisma.
  industry: z.nativeEnum(CompanyIndustry).nullable().optional(),
  enabledModules: z.array(z.nativeEnum(CompanyModule)).optional(),
});

export const updateCompanyBody = createCompanyBody.partial().extend({
  isActive: z.boolean().optional(),
});
