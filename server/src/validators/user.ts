import { z } from "zod";
import { Role } from "@prisma/client";

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
