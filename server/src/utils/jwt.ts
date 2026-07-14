import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { Role } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  companyId: string | null;
}

// The JWT itself is issued by better-auth's jwt plugin (GET /api/auth/token)
// — this app never signs one. Verification is stateless: the public key set
// is fetched from our own server's JWKS endpoint and cached/auto-refreshed
// by `jose`, so verifying a token costs no database round-trip. The fetch
// targets the loopback address rather than any externally-facing URL
// (reverse proxy, custom domain, etc) since this is a same-process,
// server-to-itself call.
const JWKS = createRemoteJWKSet(new URL(`http://127.0.0.1:${env.port}/api/auth/jwks`));

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, JWKS);
  return {
    sub: payload.sub as string,
    role: payload.role as Role,
    companyId: (payload.companyId as string | null | undefined) ?? null,
  };
}
