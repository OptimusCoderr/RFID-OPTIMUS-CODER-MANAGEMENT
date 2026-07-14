import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { Role } from "@prisma/client";

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden("You do not have permission to perform this action"));
    }
    next();
  };
}

// Resolves which companyId a request is scoped to.
// - SUPER_ADMIN may pass ?companyId= to act on any company, or omit it for cross-company reads.
// - Everyone else is locked to their own company, regardless of query params.
export function scopedCompanyId(req: Request): string | null {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === "SUPER_ADMIN") {
    return (req.query.companyId as string) ?? (req.body?.companyId as string) ?? null;
  }
  if (!req.user.companyId) {
    throw ApiError.forbidden("User is not attached to a company");
  }
  return req.user.companyId;
}

// Throws if a non-super-admin user tries to act on a companyId that isn't their own.
export function assertCompanyAccess(req: Request, companyId: string) {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === "SUPER_ADMIN") return;
  if (req.user.companyId !== companyId) {
    throw ApiError.forbidden("You do not have access to this company's data");
  }
}
