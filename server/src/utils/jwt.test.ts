import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt.js";

describe("jwt", () => {
  it("round-trips an access token payload", () => {
    const token = signAccessToken({ sub: "user-1", role: "COMPANY_ADMIN", companyId: "company-1" });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.role).toBe("COMPANY_ADMIN");
    expect(payload.companyId).toBe("company-1");
  });

  it("round-trips a refresh token payload", () => {
    const token = signRefreshToken({ sub: "user-1", jti: "session-1" });
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.jti).toBe("session-1");
  });

  it("rejects a tampered access token", () => {
    const token = signAccessToken({ sub: "user-1", role: "VIEWER", companyId: null });
    const tampered = token.slice(0, -2) + (token.slice(-2) === "aa" ? "bb" : "aa");
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("does not accept an access token as a refresh token", () => {
    const token = signAccessToken({ sub: "user-1", role: "VIEWER", companyId: null });
    expect(() => verifyRefreshToken(token)).toThrow();
  });
});
