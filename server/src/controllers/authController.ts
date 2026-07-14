import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as authService from "../services/authService.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";

const PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  companyId: true,
  isActive: true,
  lastLoginAt: true,
  company: { select: { id: true, name: true, slug: true } },
} as const;

export const registerCompany = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerCompany(req.body);
  res.status(201).json(result);
});

// Richer profile shape than better-auth's own /get-session (joins the
// company record) — kept so the client doesn't need two round-trips.
export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: PROFILE_SELECT });
  if (!user) throw ApiError.notFound("User not found");
  res.json(user);
});
