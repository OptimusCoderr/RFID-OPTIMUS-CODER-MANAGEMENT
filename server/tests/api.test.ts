import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "http";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { auth } from "../src/auth/index.js";
import { env } from "../src/config/env.js";

const app = createApp();

// verifyAccessToken (src/utils/jwt.ts) fetches this app's own /api/auth/jwks
// endpoint over real HTTP to verify JWTs statelessly — supertest's implicit
// per-request ephemeral server doesn't satisfy that self-referential fetch,
// so the suite also binds a real listener on the configured port, exactly
// like `npm run dev`/production would.
let server: Server;

const SUPER_ADMIN_EMAIL = "super@test.local";
const SUPER_ADMIN_PASSWORD = "SuperSecret123!";

async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      operation_logs, notifications, card_access_zones, verifications,
      sessions, accounts, jwks, cards, card_templates, access_zones, card_holders,
      encoders, users, companies
    RESTART IDENTITY CASCADE
  `);
}

// Signs in and mints a short-lived JWT from the resulting session — the
// bearer credential every protected app route and the dashboard websocket
// actually verify (see src/utils/jwt.ts).
async function loginAs(email: string, password: string): Promise<string> {
  const signIn = await request(app).post("/api/auth/sign-in/email").send({ email, password });
  expect(signIn.status).toBe(200);
  const sessionToken = signIn.body.token as string;

  const tokenRes = await request(app).get("/api/auth/token").set("Authorization", `Bearer ${sessionToken}`);
  expect(tokenRes.status).toBe(200);
  return tokenRes.body.token as string;
}

beforeAll(async () => {
  await resetDb();
  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(env.port, resolve);
  });
  await auth.api.signUpEmail({
    body: {
      name: "Test Super Admin",
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
      role: "SUPER_ADMIN",
    },
  });
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("auth", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/cards");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid login", async () => {
    const res = await request(app).post("/api/auth/sign-in/email").send({ email: SUPER_ADMIN_EMAIL, password: "wrong" });
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
