import { describe, it, expect } from "vitest";
import { Request } from "express";
import { scopedCompanyId, assertCompanyAccess } from "./rbac";
import { ApiError } from "../utils/ApiError";
import type { AuthUser } from "./auth";

function fakeRequest(user: AuthUser | undefined, query: Record<string, unknown> = {}, body: Record<string, unknown> = {}): Request {
  return { user, query, body } as unknown as Request;
}

describe("scopedCompanyId", () => {
  it("locks non-super-admins to their own company regardless of query params", () => {
    const req = fakeRequest({ id: "u1", role: "COMPANY_ADMIN", companyId: "company-a" }, { companyId: "company-b" });
    expect(scopedCompanyId(req)).toBe("company-a");
  });

  it("lets a super admin scope to a company via query param", () => {
    const req = fakeRequest({ id: "u1", role: "SUPER_ADMIN", companyId: null }, { companyId: "company-b" });
    expect(scopedCompanyId(req)).toBe("company-b");
  });

  it("returns null for a super admin with no companyId filter (cross-company read)", () => {
    const req = fakeRequest({ id: "u1", role: "SUPER_ADMIN", companyId: null });
    expect(scopedCompanyId(req)).toBeNull();
  });

  it("throws if a non-super-admin has no company attached", () => {
    const req = fakeRequest({ id: "u1", role: "MANAGER", companyId: null });
    expect(() => scopedCompanyId(req)).toThrow(ApiError);
  });

  it("throws unauthorized when there is no authenticated user", () => {
    const req = fakeRequest(undefined);
    expect(() => scopedCompanyId(req)).toThrow(ApiError);
  });
});

describe("assertCompanyAccess", () => {
  it("allows a super admin to access any company", () => {
    const req = fakeRequest({ id: "u1", role: "SUPER_ADMIN", companyId: null });
    expect(() => assertCompanyAccess(req, "any-company")).not.toThrow();
  });

  it("allows a user to access their own company", () => {
    const req = fakeRequest({ id: "u1", role: "OPERATOR", companyId: "company-a" });
    expect(() => assertCompanyAccess(req, "company-a")).not.toThrow();
  });

  it("forbids a user from accessing a different company", () => {
    const req = fakeRequest({ id: "u1", role: "OPERATOR", companyId: "company-a" });
    expect(() => assertCompanyAccess(req, "company-b")).toThrow(ApiError);
  });
});
