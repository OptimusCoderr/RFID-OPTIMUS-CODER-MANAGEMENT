import { Request, Response } from "express";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../lib/prisma.js";
import { auth } from "../auth/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  companyId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const users = await prisma.user.findMany({
    where: companyId ? { companyId } : {},
    select: SAFE_SELECT,
    orderBy: { fullName: "asc" },
  });
  res.json(users);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: SAFE_SELECT });
  if (!user) throw ApiError.notFound("User not found");
  if (user.companyId) assertCompanyAccess(req, user.companyId);
  else if (req.user!.role !== "SUPER_ADMIN") throw ApiError.forbidden();
  res.json(user);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, fullName, role, companyId } = req.body;

  if (req.user!.role !== "SUPER_ADMIN") {
    // Non-super-admins may only create users within their own company and cannot grant SUPER_ADMIN.
    if (role === "SUPER_ADMIN") throw ApiError.forbidden("Cannot grant super admin role");
    if (companyId && companyId !== req.user!.companyId) throw ApiError.forbidden();
  }
  if (role !== "SUPER_ADMIN" && !companyId && req.user!.role !== "SUPER_ADMIN") {
    throw ApiError.badRequest("companyId is required for non-super-admin users");
  }

  // Creates the User + Account (password) rows via better-auth, same as
  // self-service registration — this just skips the "create a company too"
  // step since the target company already exists. The session/token
  // signUpEmail returns belongs to the newly created user, not the calling
  // admin, so it's discarded here.
  await auth.api.signUpEmail({
    body: {
      name: fullName,
      email,
      password,
      role,
      companyId: role === "SUPER_ADMIN" ? undefined : companyId ?? req.user!.companyId,
    },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: SAFE_SELECT });
  res.status(201).json(user);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw ApiError.notFound("User not found");
  if (target.companyId) assertCompanyAccess(req, target.companyId);
  else if (req.user!.role !== "SUPER_ADMIN") throw ApiError.forbidden();

  const { password, ...data } = req.body;
  const user = await prisma.user.update({ where: { id: req.params.id }, data, select: SAFE_SELECT });

  // An admin resetting someone else's password — unlike the self-service
  // /change-password flow, this doesn't (and shouldn't) require knowing the
  // old password, so it's done as a direct, privileged write to the
  // credential account rather than through better-auth's own endpoint.
  if (password) {
    const hash = await hashPassword(password);
    await prisma.account.updateMany({ where: { userId: target.id, providerId: "credential" }, data: { password: hash } });
  }

  res.json(user);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw ApiError.notFound("User not found");
  if (target.companyId) assertCompanyAccess(req, target.companyId);
  else if (req.user!.role !== "SUPER_ADMIN") throw ApiError.forbidden();

  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
