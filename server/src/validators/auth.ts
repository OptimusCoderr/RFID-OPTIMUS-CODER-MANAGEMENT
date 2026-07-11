import { z } from "zod";

export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(1),
});
