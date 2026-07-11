import { z } from "zod";

export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordBody = z.object({
  email: z.string().email(),
});

export const resetPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export const updateProfileBody = z.object({
  fullName: z.string().min(2).max(200).optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).max(200).optional(),
});
