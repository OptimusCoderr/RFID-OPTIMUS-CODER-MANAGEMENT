// Central better-auth configuration.
//
// Design decisions (see HOW-TO-USE.md's auth section for the full writeup):
// - Keeps this app's own Role enum + companyId multi-tenancy fields directly
//   on the User model (as better-auth "additionalFields") rather than
//   adopting better-auth's organization/admin plugins — RBAC middleware
//   (assertCompanyAccess/scopedCompanyId) is unchanged.
// - The SPA authenticates with a short-lived bearer JWT (via the jwt
//   plugin), verified locally via JWKS with no DB round-trip per request —
//   the closest match to the JWT-based architecture this replaced. Better-
//   auth's own session token (from sign-in) is kept only for calling
//   better-auth's own endpoints (session listing/revocation, sign-out,
//   minting a fresh JWT) — the bearer plugin lets that be sent as a normal
//   Authorization header instead of a cookie.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt, bearer } from "better-auth/plugins";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { sendEmail } from "../services/emailService.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: env.appUrl,
  basePath: "/api/auth",
  secret: env.jwt.accessSecret,
  trustedOrigins: [env.clientOrigin],
  session: {
    // Matches the old refresh token's default lifetime.
    expiresIn: 60 * 60 * 24 * 30,
  },
  user: {
    // Reuse our existing column instead of adding a redundant "name" field.
    fields: { name: "fullName" },
    additionalFields: {
      role: { type: "string", required: true, input: true },
      companyId: { type: "string", required: false, input: true },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 200,
    sendResetPassword: async ({ user, token }) => {
      const resetUrl = `${env.appUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your RFID Manager password",
        text: `We received a request to reset your password. This link expires in 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      });
    },
  },
  plugins: [
    bearer(),
    jwt({
      jwt: {
        // 15 minutes — matches the old access token's lifetime.
        expirationTime: "15m",
      },
    }),
  ],
});

export type Auth = typeof auth;
