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
  company: { select: { id: true, name: true } },
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const users = await prisma.user.findMany({
    where: companyId ? { companyId } : {},
    select: SAFE_SELECT,
    // A SUPER_ADMIN browsing across every company (companyId === null, i.e.
    // no ?companyId= filter) gets users pre-sorted by company so the client
    // can render one section per company instead of a mixed list.
    orderBy: companyId ? { fullName: "asc" } : [{ company: { name: "asc" } }, { fullName: "asc" }],
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
  // The insert below falls back to the caller's own companyId when none is
  // given in the body — that only leaves a real gap when the caller has no
  // company of their own to fall back to, i.e. a SUPER_ADMIN creating a
  // non-SUPER_ADMIN user without saying which company it belongs to. This
  // used to also reject every COMPANY_ADMIN-created user (their own New
  // User form never sends companyId at all), even though the insert would
  // have resolved it correctly — company admins could never actually use
  // the "New user" button.
  if (role !== "SUPER_ADMIN" && !companyId && !req.user!.companyId) {
    throw ApiError.badRequest("companyId is required for non-super-admin users");
  }

  // Creates the User + Account (password) rows via better-auth, same as
  // self-service registration — this just skips the "create a company too"
  // step since the target company already exists. The session/token
  // signUpEmail returns belongs to the newly created user, not the calling
  // admin, so it's discarded here. role/companyId are deliberately NOT
  // passed here — better-auth's additionalFields config marks both
  // input: false (see auth/index.ts), so the new user is created with the
  // safe VIEWER/no-company default and then immediately corrected below,
  // now that the RBAC checks above have validated this caller may grant it.
  await auth.api.signUpEmail({
    body: { name: fullName, email, password },
  });

  await prisma.user.update({
    where: { email },
    data: { role, companyId: role === "SUPER_ADMIN" ? null : companyId ?? req.user!.companyId },
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
  // Mirrors createUser's equivalent check — without it, a COMPANY_ADMIN
  // could PATCH any user in their own company to SUPER_ADMIN and grant
  // them (or themselves) platform-wide access.
  if (data.role === "SUPER_ADMIN" && req.user!.role !== "SUPER_ADMIN") {
    throw ApiError.forbidden("Cannot grant super admin role");
  }
  // Without this, an admin who's just been deactivated (isActive:false) can
  // self-reactivate with the same PATCH /users/:id they're still allowed to
  // call, as long as their current JWT hasn't expired yet — deactivating
  // someone else is fine, deactivating/reactivating yourself isn't.
  if (data.isActive !== undefined && req.params.id === req.user!.id) {
    throw ApiError.forbidden("Cannot change your own active status");
  }
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
  if (target.id === req.user!.id) throw ApiError.badRequest("You cannot delete your own account");

  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
