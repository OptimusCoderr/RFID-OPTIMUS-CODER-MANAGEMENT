import { Request, Response } from "express";
import bcrypt from "bcryptjs";
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

function requestMeta(req: Request) {
  return { userAgent: req.headers["user-agent"], ipAddress: req.ip };
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password, requestMeta(req));
  res.json(result);
});

export const registerCompany = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerCompany(req.body, requestMeta(req));
  res.status(201).json(result);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken, requestMeta(req));
  res.json(result);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: PROFILE_SELECT });
  if (!user) throw ApiError.notFound("User not found");
  res.json(user);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.requestPasswordReset(req.body.email);
  // Always 204, regardless of whether the email matched an account.
  res.status(204).send();
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;
  await authService.resetPassword(token, password);
  res.status(204).send();
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const { fullName, currentPassword, newPassword } = req.body;

  const data: Record<string, unknown> = {};
  if (fullName) data.fullName = fullName;

  if (newPassword) {
    if (!currentPassword) throw ApiError.badRequest("currentPassword is required to set a new password");
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw ApiError.notFound("User not found");
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw ApiError.unauthorized("Current password is incorrect");
    data.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  const user = await prisma.user.update({ where: { id: req.user.id }, data, select: PROFILE_SELECT });
  res.json(user);
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const sessions = await authService.listSessions(req.user.id);
  res.json(sessions);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await authService.revokeSession(req.user.id, req.params.id);
  res.status(204).send();
});
