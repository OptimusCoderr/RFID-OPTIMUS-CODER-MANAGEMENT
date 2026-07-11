import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";

const app = createApp();

const SUPER_ADMIN_EMAIL = "super@test.local";
const SUPER_ADMIN_PASSWORD = "SuperSecret123!";

async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      operation_logs, notifications, card_access_zones, password_reset_tokens,
      refresh_tokens, cards, card_templates, access_zones, card_holders,
      encoders, users, companies
    RESTART IDENTITY CASCADE
  `);
}

async function loginAs(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  await resetDb();
  await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(SUPER_ADMIN_PASSWORD, 4),
      fullName: "Test Super Admin",
      role: "SUPER_ADMIN",
    },
  });
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe("auth", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/cards");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid login", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: SUPER_ADMIN_EMAIL, password: "wrong" });
    expect(res.status).toBe(401);
  });
});

describe("company + card lifecycle happy path", () => {
  let superAdminToken: string;
  let companyId: string;
  let companyAdminToken: string;
  let cardId: string;

  beforeAll(async () => {
    superAdminToken = await loginAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  });

  it("lets a super admin create a company", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ name: "Integration Test Co", slug: "integration-test-co" });
    expect(res.status).toBe(201);
    companyId = res.body.id;
  });

  it("lets a super admin create a company admin for that company", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        email: "admin@integration-test-co.example",
        password: "CompanyAdmin123!",
        fullName: "Integration Company Admin",
        role: "COMPANY_ADMIN",
        companyId,
      });
    expect(res.status).toBe(201);

    companyAdminToken = await loginAs("admin@integration-test-co.example", "CompanyAdmin123!");
  });

  it("lets the company admin register a card scoped to their own company", async () => {
    const res = await request(app)
      .post("/api/cards")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ uid: "04DEADBEEF", cardType: "NTAG213", label: "Integration Badge" });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(companyId);
    cardId = res.body.id;
  });

  it("rejects registering a duplicate UID for the same company", async () => {
    const res = await request(app)
      .post("/api/cards")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ uid: "04DEADBEEF", cardType: "NTAG213" });
    expect(res.status).toBe(409);
  });

  it("lists the newly created card", async () => {
    const res = await request(app).get("/api/cards").set("Authorization", `Bearer ${companyAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === cardId)).toBe(true);
  });

  it("blocking a card generates a notification for the company admin", async () => {
    const blockRes = await request(app)
      .post(`/api/cards/${cardId}/block`)
      .set("Authorization", `Bearer ${companyAdminToken}`);
    expect(blockRes.status).toBe(200);
    expect(blockRes.body.status).toBe("BLOCKED");

    const notifRes = await request(app).get("/api/notifications").set("Authorization", `Bearer ${companyAdminToken}`);
    expect(notifRes.status).toBe(200);
    expect(notifRes.body.data.some((n: { type: string }) => n.type === "CARD_BLOCKED")).toBe(true);
  });

  it("logs the operations to the audit trail", async () => {
    const res = await request(app).get("/api/logs").set("Authorization", `Bearer ${companyAdminToken}`);
    expect(res.status).toBe(200);
    const types = res.body.data.map((l: { operationType: string }) => l.operationType);
    expect(types).toContain("REGISTER");
    expect(types).toContain("BLOCK");
  });

  describe("tenant isolation", () => {
    let otherCompanyAdminToken: string;

    beforeAll(async () => {
      const companyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Other Co", slug: "other-co" });
      const otherCompanyId = companyRes.body.id;

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: "admin@other-co.example",
          password: "OtherAdmin123!",
          fullName: "Other Company Admin",
          role: "COMPANY_ADMIN",
          companyId: otherCompanyId,
        });

      otherCompanyAdminToken = await loginAs("admin@other-co.example", "OtherAdmin123!");
    });

    it("forbids a company admin from reading another company's card", async () => {
      const res = await request(app).get(`/api/cards/${cardId}`).set("Authorization", `Bearer ${otherCompanyAdminToken}`);
      expect(res.status).toBe(403);
    });

    it("only shows each company admin their own company's cards in the list", async () => {
      const res = await request(app).get("/api/cards").set("Authorization", `Bearer ${otherCompanyAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: { id: string }) => c.id === cardId)).toBe(false);
    });
  });
});
