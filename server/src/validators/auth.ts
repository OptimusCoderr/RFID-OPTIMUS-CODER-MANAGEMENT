import { z } from "zod";

// Sign-in/sign-up/sign-out, forgot/reset-password, and session listing are
// all handled directly by better-auth's own mounted routes (see src/app.ts) —
// this file only validates the custom endpoints that layer app-specific
// behavior (multi-tenant company registration) on top.
export const registerCompanyBody = z.object({
  companyName: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens"),
  contactEmail: z.string().email().optional(),
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
