import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { env } from "../config/env.js";
import { sendEmail } from "./emailService.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function ttlToDate(ttl: string): Date {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  const now = Date.now();
  if (!match) return new Date(now + 30 * 24 * 60 * 60 * 1000);
  const amount = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return new Date(now + amount * unitMs);
}

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export async function login(email: string, password: string, meta: RequestMeta = {}) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role, companyId: user.companyId });
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, jti });

  await prisma.refreshToken.create({
    data: {
      id: jti,
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: ttlToDate(env.jwt.refreshTtl),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { passwordHash: _passwordHash, ...safeUser } = user;
  return { user: safeUser, accessToken, refreshToken };
}

interface RegisterCompanyInput {
  companyName: string;
  slug: string;
  contactEmail?: string;
  fullName: string;
  email: string;
  password: string;
}

// Self-service sign-up: a new business (hotel, university, etc) registers
// itself and its first user, who becomes COMPANY_ADMIN of a brand-new
// company. No SUPER_ADMIN involvement needed. Company/user creation is
// transactional so a failure never leaves an orphaned company with no admin.
export async function registerCompany(input: RegisterCompanyInput, meta: RequestMeta = {}) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        slug: input.slug,
        contactEmail: input.contactEmail,
      },
    });
    return tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        role: "COMPANY_ADMIN",
        companyId: company.id,
      },
      include: { company: { select: { id: true, name: true, slug: true } } },
    });
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, companyId: user.companyId });
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, jti });

  await prisma.refreshToken.create({
    data: {
      id: jti,
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: ttlToDate(env.jwt.refreshTtl),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { passwordHash: _passwordHash, ...safeUser } = user;
  return { user: safeUser, accessToken, refreshToken };
}

export async function refresh(token: string, meta: RequestMeta = {}) {
  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid refresh token");
  }

  const record = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
  if (!record || record.revokedAt || record.tokenHash !== hashToken(token) || record.expiresAt < new Date()) {
    throw ApiError.unauthorized("Refresh token is no longer valid");
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Account is inactive");
  }

  // Rotate: revoke the old token, issue a new pair.
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, companyId: user.companyId });
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, jti });
  await prisma.refreshToken.create({
    data: {
      id: jti,
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: ttlToDate(env.jwt.refreshTtl),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  return { accessToken, refreshToken };
}

export async function listSessions(userId: string) {
  return prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
  });
}

export async function revokeSession(userId: string, sessionId: string) {
  const record = await prisma.refreshToken.findUnique({ where: { id: sessionId } });
  if (!record || record.userId !== userId) throw ApiError.notFound("Session not found");
  await prisma.refreshToken.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function logout(token: string) {
  try {
    const payload = verifyRefreshToken(token);
    await prisma.refreshToken.updateMany({
      where: { id: payload.jti },
      data: { revokedAt: new Date() },
    });
  } catch {
    // already invalid/expired — logout is idempotent either way
  }
}

// Always succeeds from the caller's perspective — never reveals whether an
// email address has an account, to avoid leaking account existence.
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return;

  const rawToken = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${env.appUrl.replace(/\/$/, "")}/reset-password?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your RFID Manager password",
    text: `We received a request to reset your password. This link expires in 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw ApiError.badRequest("This reset link is invalid or has expired");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Revoke every active session — a password reset should force re-login everywhere.
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}
