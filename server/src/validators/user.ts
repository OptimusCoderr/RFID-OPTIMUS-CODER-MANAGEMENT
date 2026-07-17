import { z } from "zod";
import { Role } from "@prisma/client";

// Not the shared idParams (validators/common.ts): User rows are created via
// better-auth's signUpEmail (both self-registration and admin-created
// users), which assigns its own ID format rather than going through
// Prisma's `@default(uuid())` — every other resource in this app is
// created directly via Prisma and does get a real UUID, but a strict
// .uuid() check here would reject every real user ID.
export const userIdParams = z.object({
  id: z.string().min(1).max(255),
});

export const createUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  fullName: z.string().min(2).max(200),
  role: z.nativeEnum(Role),
  companyId: z.string().uuid().nullable().optional(),
});

export const updateUserBody = z.object({
  fullName: z.string().min(2).max(200).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});
