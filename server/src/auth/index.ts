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
import { betterAuth, APIError } from "better-auth";
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
      // input: false is load-bearing security, not a style choice: it's what
      // stops role/companyId from being settable through better-auth's own
      // public POST /sign-up/email (unauthenticated) and POST /update-user
      // (any signed-in session) endpoints — both accept arbitrary
      // "input: true" fields straight from the request body with no RBAC
      // check of their own. Without this, anyone could sign up (or update
      // themselves) with role: "SUPER_ADMIN" and get full platform access.
      // The only legitimate way to set these is our own server-side code
      // calling auth.api.signUpEmail() and then immediately overwriting
      // role/companyId with a follow-up prisma.user.update() once our own
      // RBAC checks (in userController.createUser / authService.
      // registerCompany) have already validated the caller is allowed to
      // grant that role/company — see those two call sites.
      role: { type: "string", required: false, defaultValue: "VIEWER", input: false },
      companyId: { type: "string", required: false, input: false },
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
        // 15 minutes — matches the old access token's lifetime. Also the
        // outer bound on how stale a deactivated user's or a suspended
        // company's access can be: verifyAccessToken (utils/jwt.ts) is
        // stateless and never re-reads the DB, so the only place that
        // isActive can be enforced is here, at mint time — every dead
        // token naturally expires and forces a remint through this
        // definePayload check within 15 minutes, rather than staying
        // valid for the full 30-day session lifetime.
        expirationTime: "15m",
        definePayload: async (session) => {
          const user = session.user as unknown as { role: string; companyId: string | null; isActive: boolean };
          if (!user.isActive) {
            throw new APIError("FORBIDDEN", { message: "This account has been deactivated" });
          }
          if (user.companyId) {
            const company = await prisma.company.findUnique({ where: { id: user.companyId }, select: { isActive: true } });
            if (!company?.isActive) {
              throw new APIError("FORBIDDEN", { message: "This company has been suspended" });
            }
          }
          return { role: user.role, companyId: user.companyId };
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
