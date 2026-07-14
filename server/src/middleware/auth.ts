import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { Role } from "@prisma/client";

export interface AuthUser {
  id: string;
  role: Role;
  companyId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(ApiError.unauthorized("Missing bearer token"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = await verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, companyId: payload.companyId };
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}
