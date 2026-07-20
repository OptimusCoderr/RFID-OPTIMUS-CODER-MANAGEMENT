import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "http";
import request from "supertest";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { auth } from "../src/auth/index.js";
import { env } from "../src/config/env.js";
import { initWebsocket } from "../src/websocket/index.js";

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
      operation_logs, notifications, card_access_zones, attendance_records, verifications,
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
  initWebsocket(server);
  // role is input: false on the better-auth user schema (see src/auth/index.ts)
  // so it can't be passed through signUpEmail's body directly — this mirrors
  // how the app itself bootstraps its first SUPER_ADMIN (prisma/seed.ts).
  await auth.api.signUpEmail({
    body: { name: "Test Super Admin", email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD },
  });
  await prisma.user.update({ where: { email: SUPER_ADMIN_EMAIL }, data: { role: "SUPER_ADMIN" } });
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

  it("blocks the public sign-up endpoint entirely", async () => {
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ name: "Attacker", email: "attacker@evil.example", password: "Password123!" });
    expect(res.status).toBe(404);

    const found = await prisma.user.findUnique({ where: { email: "attacker@evil.example" } });
    expect(found).toBeNull();
  });

  it("cannot self-grant SUPER_ADMIN via better-auth's own update-user endpoint", async () => {
    const email = "escalation-target@integration-test.example";
    const password = "TargetUser123!";
    await auth.api.signUpEmail({ body: { name: "Escalation Target", email, password } });

    const signIn = await request(app).post("/api/auth/sign-in/email").send({ email, password });
    expect(signIn.status).toBe(200);
    const sessionToken = signIn.body.token as string;

    const before = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(before.role).toBe("VIEWER");
    expect(before.companyId).toBeNull();

    const escalate = await request(app)
      .post("/api/auth/update-user")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ role: "SUPER_ADMIN" });
    expect(escalate.status).toBe(400);

    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.role).toBe("VIEWER");

    // The endpoint's actual legitimate use (renaming yourself) still works.
    const rename = await request(app)
      .post("/api/auth/update-user")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ name: "Renamed Target" });
    expect(rename.status).toBe(200);
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

  it("searches holders by name/employeeId/email server-side, and respects a limit", async () => {
    await request(app)
      .post("/api/holders")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ fullName: "Zzyzx Search Target", employeeId: "EMP-SEARCH-1" });
    await request(app)
      .post("/api/holders")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ fullName: "Someone Else" });

    const res = await request(app)
      .get("/api/holders")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .query({ search: "Zzyzx" });
    expect(res.status).toBe(200);
    expect(res.body.every((h: { fullName: string }) => h.fullName.includes("Zzyzx"))).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const byEmployeeId = await request(app)
      .get("/api/holders")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .query({ search: "EMP-SEARCH-1" });
    expect(byEmployeeId.body.some((h: { employeeId?: string }) => h.employeeId === "EMP-SEARCH-1")).toBe(true);

    const limited = await request(app)
      .get("/api/holders")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .query({ limit: 1 });
    expect(limited.body.length).toBeLessThanOrEqual(1);
  });

  it("lets the company admin edit a card's label and notes", async () => {
    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ label: "Renamed Badge", notes: "some notes" });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("Renamed Badge");
    expect(res.body.notes).toBe("some notes");
  });

  it("lets the company admin clear a card's label and notes back to null", async () => {
    const res = await request(app)
      .patch(`/api/cards/${cardId}`)
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ label: null, notes: null });
    expect(res.status).toBe(200);
    expect(res.body.label).toBeNull();
    expect(res.body.notes).toBeNull();
  });

  it("rejects an OPERATOR deleting a card, but allows editing it", async () => {
    const operatorRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({
        email: "operator@integration-test-co.example",
        password: "Operator123!",
        fullName: "Integration Operator",
        role: "OPERATOR",
        companyId,
      });
    expect(operatorRes.status).toBe(201);
    const operatorToken = await loginAs("operator@integration-test-co.example", "Operator123!");

    const editRes = await request(app)
      .patch(`/api/cards/${cardId}`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ label: "Operator Edited" });
    expect(editRes.status).toBe(200);
    expect(editRes.body.label).toBe("Operator Edited");

    const deleteRes = await request(app)
      .delete(`/api/cards/${cardId}`)
      .set("Authorization", `Bearer ${operatorToken}`);
    expect(deleteRes.status).toBe(403);
  });

  it("lets a company admin delete a card", async () => {
    const createRes = await request(app)
      .post("/api/cards")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ uid: "04DEAD1234", cardType: "NTAG213" });
    expect(createRes.status).toBe(201);
    const scratchCardId = createRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/cards/${scratchCardId}`)
      .set("Authorization", `Bearer ${companyAdminToken}`);
    expect(deleteRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/cards/${scratchCardId}`)
      .set("Authorization", `Bearer ${companyAdminToken}`);
    expect(getRes.status).toBe(404);
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

  it("setting BLOCKED via the generic PATCH also generates a notification, same as the dedicated /block endpoint", async () => {
    const cardRes = await request(app)
      .post("/api/cards")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ uid: "04B0AC4000", cardType: "NTAG213" });

    const patchRes = await request(app)
      .patch(`/api/cards/${cardRes.body.id}`)
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ status: "BLOCKED" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("BLOCKED");

    const notifRes = await request(app).get("/api/notifications").set("Authorization", `Bearer ${companyAdminToken}`);
    const matches = notifRes.body.data.filter(
      (n: { type: string; link: string }) => n.type === "CARD_BLOCKED" && n.link === `/cards/${cardRes.body.id}`
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("rejects assigning or unassigning a blocked card, so it can't be silently reactivated", async () => {
    // cardId is BLOCKED from the previous test.
    const holderRes = await request(app)
      .post("/api/holders")
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ fullName: "Bypass Attempt Holder" });

    const assignRes = await request(app)
      .post(`/api/cards/${cardId}/assign`)
      .set("Authorization", `Bearer ${companyAdminToken}`)
      .send({ holderId: holderRes.body.id });
    expect(assignRes.status).toBe(400);

    const unassignRes = await request(app).post(`/api/cards/${cardId}/unassign`).set("Authorization", `Bearer ${companyAdminToken}`);
    expect(unassignRes.status).toBe(400);

    const check = await request(app).get(`/api/cards/${cardId}`).set("Authorization", `Bearer ${companyAdminToken}`);
    expect(check.body.status).toBe("BLOCKED");
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

  describe("templates", () => {
    it("rejects a citizen record with a repeated block number", async () => {
      const res = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Bad Citizen Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: {
            citizenRecord: {
              fields: ["name"],
              blocks: [
                { sector: 1, block: 4 },
                { sector: 1, block: 4 },
              ],
            },
          },
        });
      expect(res.status).toBe(400);
    });

    it("only ever leaves one template marked isDefault per cardType, even under concurrent writes", async () => {
      // Seed one existing default so the race exercises both the create
      // path's and update path's "clear other defaults" transaction.
      const firstRes = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Default Race Template A", cardType: "NTAG213", isDefault: true, layout: {} });
      expect(firstRes.body.isDefault).toBe(true);

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(app)
            .post("/api/templates")
            .set("Authorization", `Bearer ${companyAdminToken}`)
            .send({ name: `Default Race Template ${i}`, cardType: "NTAG213", isDefault: true, layout: {} })
        )
      );
      expect(results.every((r) => r.status === 201)).toBe(true);

      const listRes = await request(app).get("/api/templates").set("Authorization", `Bearer ${companyAdminToken}`);
      const ntagDefaults = listRes.body.filter(
        (t: { cardType: string; isDefault: boolean }) => t.cardType === "NTAG213" && t.isDefault
      );
      expect(ntagDefaults).toHaveLength(1);
    });

    it("accepts a valid citizen record", async () => {
      const res = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Good Citizen Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: {
            citizenRecord: {
              fields: ["name"],
              blocks: [
                { sector: 1, block: 4 },
                { sector: 1, block: 5 },
              ],
            },
          },
        });
      expect(res.status).toBe(201);
    });

    it("lets a company admin edit an existing template's name and layout", async () => {
      const createRes = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Editable Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: { sectors: [{ sector: 1, keyA: "FFFFFFFFFFFF" }] },
        });
      expect(createRes.status).toBe(201);
      const templateId = createRes.body.id;

      const updateRes = await request(app)
        .patch(`/api/templates/${templateId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Renamed Template",
          layout: { sectors: [{ sector: 1, keyA: "FFFFFFFFFFFF" }, { sector: 2, keyA: "FFFFFFFFFFFF" }] },
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe("Renamed Template");
      expect(updateRes.body.layout.sectors).toHaveLength(2);
    });

    it("rejects a citizen record block that lands on a sector trailer", async () => {
      const res = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Bad Trailer Citizen Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: {
            citizenRecord: {
              fields: ["name"],
              blocks: [{ sector: 1, block: 7 }], // sector 1's trailer
            },
          },
        });
      expect(res.status).toBe(400);
    });

    it("rejects a plain labeled block that lands on the manufacturer block", async () => {
      const res = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Bad Manufacturer Block Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: {
            sectors: [{ sector: 0, blocks: [{ block: 0, purpose: "Should be rejected" }] }],
          },
        });
      expect(res.status).toBe(400);
    });

    it("rejects a plain labeled block that lands on a sector trailer", async () => {
      const res = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Bad Trailer Block Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: {
            sectors: [{ sector: 1, blocks: [{ block: 7, purpose: "Should be rejected" }] }],
          },
        });
      expect(res.status).toBe(400);
    });

    it("accepts a plain labeled block on an ordinary sector data block", async () => {
      const res = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          name: "Good Plain Block Template",
          cardType: "MIFARE_CLASSIC_1K",
          layout: {
            sectors: [{ sector: 1, blocks: [{ block: 4, purpose: "Full Name" }] }],
          },
        });
      expect(res.status).toBe(201);
    });
  });

  describe("bulk import", () => {
    it("creates valid rows, skips existing UIDs, reports per-row errors, and drops foreign templateIds", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Bulk Import Other Co", slug: "bulk-import-other-co" });
      const foreignTemplateRes = await request(app)
        .post("/api/templates")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Foreign Template", cardType: "NTAG213", companyId: otherCompanyRes.body.id, layout: {} });

      const res = await request(app)
        .post("/api/cards/bulk-import")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          rows: [
            { uid: "04B01C0001", cardType: "NTAG213" },
            { uid: "04B01C0002", cardType: "NTAG213", templateId: foreignTemplateRes.body.id },
            { uid: "04B01C0001", cardType: "NTAG213" }, // duplicate within the batch
            { uid: "not-hex", cardType: "NTAG213" },
            { uid: "04B01C0003" }, // missing cardType
            { uid: "04DEADBEEF", cardType: "NTAG213" }, // already registered in an earlier test
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.created).toBe(2);
      expect(res.body.skipped).toBe(1);
      expect(res.body.errors).toHaveLength(3);
      expect(res.body.errors.map((e: { error: string }) => e.error)).toEqual(
        expect.arrayContaining([
          "Duplicate UID within this import",
          "Invalid or missing UID (expected 8-20 hex characters)",
          "Missing cardType",
        ])
      );

      const listRes = await request(app)
        .get("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ search: "04B01C0002" });
      const imported = listRes.body.data.find((c: { uid: string }) => c.uid === "04B01C0002");
      expect(imported).toBeTruthy();
      expect(imported.templateId).toBeNull(); // foreign templateId silently dropped, not attached
    });
  });

  describe("attendance", () => {
    let attendeeCardId: string;

    beforeAll(async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Attendance Test Student" });
      const holderId = holderRes.body.id;

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04A77E4D01", cardType: "NTAG213" });
      attendeeCardId = cardRes.body.id;

      await request(app)
        .post(`/api/cards/${attendeeCardId}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId });
    });

    it("rejects recording attendance for a blocked card", async () => {
      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId }); // blocked in an earlier test in this file
      expect(res.status).toBe(400);
    });

    it("rejects recording attendance for an expired card", async () => {
      // EXPIRED is only ever set by the background expiry job, not reachable
      // via any API — set it directly to exercise the check.
      await prisma.card.update({ where: { id: attendeeCardId }, data: { status: "EXPIRED" } });

      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: attendeeCardId });
      expect(res.status).toBe(400);

      await prisma.card.update({ where: { id: attendeeCardId }, data: { status: "ASSIGNED" } });
    });

    it("rejects recording attendance for a card with no holder assigned", async () => {
      const unassignedCardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04B0B0B0B0", cardType: "NTAG213" });

      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: unassignedCardRes.body.id });
      expect(res.status).toBe(400);
    });

    it("rejects recording attendance against another company's zone or encoder", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Attendance Test Other Co", slug: "attendance-test-other-co" });
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: "admin@attendance-test-other-co.example",
          password: "OtherAdmin123!",
          fullName: "Attendance Test Other Admin",
          role: "COMPANY_ADMIN",
          companyId: otherCompanyRes.body.id,
        });
      const otherAdminToken = await loginAs("admin@attendance-test-other-co.example", "OtherAdmin123!");

      const otherZoneRes = await request(app)
        .post("/api/zones")
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .send({ name: "Other Co Private Zone" });
      const otherEncoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .send({ name: "Other Co Private Encoder", type: "ACR122U" });

      const zoneRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: attendeeCardId, zoneId: otherZoneRes.body.id });
      expect(zoneRes.status).toBe(400);

      const encoderRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: attendeeCardId, encoderId: otherEncoderRes.body.id });
      expect(encoderRes.status).toBe(400);
    });

    it("checks a holder in on first tap", async () => {
      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: attendeeCardId });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("CHECK_IN");
    });

    it("checks the same holder out on the next tap", async () => {
      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: attendeeCardId });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("CHECK_OUT");
    });

    it("tracks a zone's check-in state independently from the general one", async () => {
      const zoneRes = await request(app)
        .post("/api/zones")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Lecture Hall A" });
      const zoneId = zoneRes.body.id;

      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: attendeeCardId, zoneId });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("CHECK_IN"); // independent of the general CHECK_OUT state above
    });

    it("lists recorded attendance for the company", async () => {
      const res = await request(app).get("/api/attendance").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      expect(res.body.data.every((r: { holder: { id: string } }) => r.holder)).toBe(true);
    });

    it("includes the holder's employee/student ID number on the recorded attendance", async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "ID Number Test Student", employeeId: "STU-4521" });
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04CC33DD44", cardType: "NTAG213" });
      await request(app)
        .post(`/api/cards/${cardRes.body.id}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });

      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardRes.body.id });
      expect(res.status).toBe(201);
      expect(res.body.holder.employeeId).toBe("STU-4521");

      const listRes = await request(app)
        .get("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ holderId: holderRes.body.id });
      expect(listRes.body.data[0].holder.employeeId).toBe("STU-4521");
    });

    it("rejects an operator-below role (VIEWER) from recording attendance", async () => {
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "viewer@integration-test-co.example",
          password: "ViewerOnly123!",
          fullName: "Integration Viewer",
          role: "VIEWER",
          companyId,
        });
      const viewerToken = await loginAs("viewer@integration-test-co.example", "ViewerOnly123!");

      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ cardId: attendeeCardId });
      expect(res.status).toBe(403);
    });
  });

  describe("manual attendance entry (holder's physical card lost/unavailable)", () => {
    let manualHolderId: string;

    beforeAll(async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Manual Entry Test Holder" });
      manualHolderId = holderRes.body.id;
    });

    it("lets a manager record a manual check-in for a holder with no card tapped", async () => {
      const res = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: manualHolderId });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("CHECK_IN");
      expect(res.body.manualEntry).toBe(true);
      expect(res.body.cardId).toBeFalsy();
      expect(res.body.recordedByUser).toBeTruthy();
    });

    it("shows manual entries distinctly in the CSV export instead of a blank Card column indistinguishable from a data gap", async () => {
      const exportRes = await request(app)
        .get("/api/attendance/export")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ holderId: manualHolderId });
      expect(exportRes.status).toBe(200);
      const [header, ...rows] = exportRes.text.trim().split("\r\n");
      expect(header).toContain("Manual entry");
      expect(header).toContain("Recorded by");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.includes(",Yes,"))).toBe(true);
    });

    it("alternates to check-out on the next manual entry for the same holder", async () => {
      const res = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: manualHolderId });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe("CHECK_OUT");
    });

    it("interleaves correctly with a real card tap for the same holder+zone scope", async () => {
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04DD11EE22", cardType: "NTAG213" });
      await request(app)
        .post(`/api/cards/${cardRes.body.id}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: manualHolderId });

      // Last manual entry above left this holder CHECK_OUT'd — a real tap
      // now (e.g. the replacement card arrives) should pick up from there.
      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardRes.body.id });
      expect(tapRes.status).toBe(201);
      expect(tapRes.body.type).toBe("CHECK_IN");

      const manualRes = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: manualHolderId });
      expect(manualRes.status).toBe(201);
      expect(manualRes.body.type).toBe("CHECK_OUT");
    });

    it("rejects an OPERATOR (below MANAGER) from recording a manual entry", async () => {
      const operatorToken = await loginAs("operator@integration-test-co.example", "Operator123!");
      const res = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ holderId: manualHolderId });
      expect(res.status).toBe(403);
    });

    it("rejects a manual entry for another company's holder", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Manual Entry Test Other Co", slug: "manual-entry-test-other-co" });
      const otherHolderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ fullName: "Other Co Holder", companyId: otherCompanyRes.body.id });

      const res = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: otherHolderRes.body.id });
      expect(res.status).toBe(400);
    });

    it("rejects a manual entry against another company's zone", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Manual Entry Test Zone Co", slug: "manual-entry-test-zone-co" });
      const otherZoneRes = await request(app)
        .post("/api/zones")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Other Co Zone", companyId: otherCompanyRes.body.id });

      const res = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: manualHolderId, zoneId: otherZoneRes.body.id });
      expect(res.status).toBe(400);
    });
  });

  describe("attendance record editing and bulk clear", () => {
    let editCardId: string;
    let editHolderId: string;
    let editZoneId: string;
    let editRecordId: string;

    beforeAll(async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Edit/Clear Test Holder" });
      editHolderId = holderRes.body.id;

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04EE22FF33", cardType: "NTAG213" });
      editCardId = cardRes.body.id;
      await request(app)
        .post(`/api/cards/${editCardId}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: editHolderId });

      const zoneRes = await request(app)
        .post("/api/zones")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Edit/Clear Test Zone" });
      editZoneId = zoneRes.body.id;

      const recordRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: editCardId, zoneId: editZoneId });
      editRecordId = recordRes.body.id;
    });

    it("lets a manager correct a record's type and recordedAt", async () => {
      const newRecordedAt = new Date("2026-01-15T09:00:00.000Z").toISOString();
      const res = await request(app)
        .patch(`/api/attendance/${editRecordId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ type: "CHECK_OUT", recordedAt: newRecordedAt });
      expect(res.status).toBe(200);
      expect(res.body.type).toBe("CHECK_OUT");
      expect(new Date(res.body.recordedAt).toISOString()).toBe(newRecordedAt);
    });

    it("rejects an edit body with neither type nor recordedAt", async () => {
      const res = await request(app)
        .patch(`/api/attendance/${editRecordId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects an OPERATOR from editing a record", async () => {
      const operatorToken = await loginAs("operator@integration-test-co.example", "Operator123!");
      const res = await request(app)
        .patch(`/api/attendance/${editRecordId}`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ type: "CHECK_IN" });
      expect(res.status).toBe(403);
    });

    it("rejects editing another company's attendance record", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Edit Test Other Co", slug: "edit-test-other-co" });
      const otherHolderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ fullName: "Other Co Holder", companyId: otherCompanyRes.body.id });
      const otherManualRes = await request(app)
        .post("/api/attendance/manual")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ holderId: otherHolderRes.body.id, companyId: otherCompanyRes.body.id });

      const res = await request(app)
        .patch(`/api/attendance/${otherManualRes.body.id}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ type: "CHECK_OUT" });
      expect(res.status).toBe(403);
    });

    it("rejects clearing attendance with no filter at all", async () => {
      const res = await request(app)
        .delete("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(400);
    });

    it("clears only the records matching the given filter, scoped to the caller's company", async () => {
      const beforeRes = await request(app)
        .get("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ zoneId: editZoneId, pageSize: 1 });
      const totalBefore = beforeRes.body.pagination.total;
      expect(totalBefore).toBeGreaterThan(0);

      const clearRes = await request(app)
        .delete("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ zoneId: editZoneId });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body.deleted).toBe(totalBefore);

      const afterRes = await request(app)
        .get("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ zoneId: editZoneId, pageSize: 1 });
      expect(afterRes.body.pagination.total).toBe(0);
    });

    it("clearing a zone's records lets a new schedule start fresh instead of inheriting the old check-in/check-out state", async () => {
      // Reproduces the reported bug: tap in this zone, then simulate opening
      // a brand-new schedule that reuses the same zone — without a clear,
      // the very next tap would read as CHECK_OUT ("already checked in").
      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: editCardId, zoneId: editZoneId });
      expect(tapRes.body.type).toBe("CHECK_IN");

      await request(app)
        .delete("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ zoneId: editZoneId });

      const freshRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: editCardId, zoneId: editZoneId });
      expect(freshRes.body.type).toBe("CHECK_IN");
    });

    it("rejects an OPERATOR from clearing attendance", async () => {
      const operatorToken = await loginAs("operator@integration-test-co.example", "Operator123!");
      const res = await request(app)
        .delete("/api/attendance")
        .set("Authorization", `Bearer ${operatorToken}`)
        .query({ zoneId: editZoneId });
      expect(res.status).toBe(403);
    });
  });

  describe("attendance sessions: multiple schedules per encoder, like a university course catalog", () => {
    let sessionEncoderId: string;
    let sessionCardId: string;
    let sessionId: string;

    beforeAll(async () => {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Lecture Hall Encoder", type: "ACR122U" });
      sessionEncoderId = encoderRes.body.id;

      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Session Test Student" });

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04AA11BB22", cardType: "NTAG213" });
      sessionCardId = cardRes.body.id;

      await request(app)
        .post(`/api/cards/${sessionCardId}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });
    });

    it("lists no schedules for a fresh encoder (unrestricted)", async () => {
      const res = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: sessionEncoderId });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("accepts attendance taps against an encoder with no schedules", async () => {
      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(res.status).toBe(201);
    });

    it("rejects an operator-below role (VIEWER) from creating a schedule", async () => {
      const viewerToken = await loginAs("viewer@integration-test-co.example", "ViewerOnly123!");
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ encoderId: sessionEncoderId, daysOfWeek: [], startTime: "09:00", endTime: "10:00" });
      expect(res.status).toBe(403);
    });

    it("rejects creating a schedule with no label", async () => {
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId: sessionEncoderId, daysOfWeek: [], startTime: "09:00", endTime: "10:00" });
      expect(res.status).toBe(400);
    });

    it("rejects creating a schedule with a blank/whitespace-only label", async () => {
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId: sessionEncoderId, label: "   ", daysOfWeek: [], startTime: "09:00", endTime: "10:00" });
      expect(res.status).toBe(400);
    });

    it("creates a schedule and round-trips a description alongside the required label", async () => {
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          encoderId: sessionEncoderId,
          label: "CS101 Lecture",
          description: "Room 204, Mon/Wed/Fri mornings",
          daysOfWeek: [],
        });
      expect(res.status).toBe(201);
      expect(res.body.label).toBe("CS101 Lecture");
      expect(res.body.description).toBe("Room 204, Mon/Wed/Fri mornings");
      sessionId = res.body.id;

      const listRes = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: sessionEncoderId });
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].description).toBe("Room 204, Mon/Wed/Fri mornings");
    });

    it("edits the schedule's recurring window with a PATCH by id, currently closed and blocking taps outside it", async () => {
      // Scheduled for a day-of-week other than today, so it's guaranteed
      // closed right now regardless of when this suite runs.
      const otherDay = (new Date().getDay() + 3) % 7;
      const res = await request(app)
        .patch(`/api/attendance-sessions/${sessionId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ daysOfWeek: [otherDay], startTime: "09:00", endTime: "10:00" });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe("CS101 Lecture"); // untouched by the partial update
      expect(res.body.state.isOpen).toBe(false);
      expect(res.body.state.reason).toBe("scheduled_closed");
      expect(res.body.state.nextBoundaryAt).not.toBeNull();

      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(tapRes.status).toBe(400);
      expect(tapRes.body.error).toMatch(/not currently open/i);
    });

    it("Start now (FORCE_OPEN) opens attendance immediately, overriding the schedule", async () => {
      const overrideRes = await request(app)
        .patch(`/api/attendance-sessions/${sessionId}/override`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ manualOverride: "FORCE_OPEN" });
      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.state.isOpen).toBe(true);
      expect(overrideRes.body.state.reason).toBe("manual_open");
      expect(overrideRes.body.state.nextBoundaryAt).toBeNull();

      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(tapRes.status).toBe(201);
      // The tap snapshots which schedule was open — lets attendance later be
      // exported/filtered by class/shift, not just by encoder or time range.
      expect(tapRes.body.sessionId).toBe(sessionId);
      expect(tapRes.body.sessionLabel).toBe("CS101 Lecture");
    });

    it("filters attendance records by sessionId and by sessionLabel, and the export includes a Schedule column", async () => {
      const bySessionId = await request(app)
        .get("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ sessionId });
      expect(bySessionId.status).toBe(200);
      expect(bySessionId.body.data.length).toBeGreaterThan(0);
      expect(bySessionId.body.data.every((r: { sessionId: string }) => r.sessionId === sessionId)).toBe(true);

      const bySessionLabel = await request(app)
        .get("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ sessionLabel: "CS101 Lecture" });
      expect(bySessionLabel.status).toBe(200);
      expect(bySessionLabel.body.data.length).toBeGreaterThan(0);
      expect(bySessionLabel.body.data.every((r: { sessionLabel: string }) => r.sessionLabel === "CS101 Lecture")).toBe(true);

      const exportRes = await request(app)
        .get("/api/attendance/export")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ sessionId });
      expect(exportRes.status).toBe(200);
      const [header, ...rows] = exportRes.text.trim().split("\r\n");
      expect(header).toContain("Schedule");
      expect(rows.every((row) => row.includes("CS101 Lecture"))).toBe(true);
    });

    it("Stop now (FORCE_CLOSED) blocks attendance even during what would be an open window", async () => {
      const overrideRes = await request(app)
        .patch(`/api/attendance-sessions/${sessionId}/override`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ manualOverride: "FORCE_CLOSED" });
      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.state.isOpen).toBe(false);
      expect(overrideRes.body.state.reason).toBe("manual_closed");

      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(tapRes.status).toBe(400);
    });

    it("Resume schedule (NONE) clears the override and reverts to the saved schedule's state", async () => {
      const overrideRes = await request(app)
        .patch(`/api/attendance-sessions/${sessionId}/override`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ manualOverride: "NONE" });
      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.state.reason).toBe("scheduled_closed"); // same fixed schedule from the earlier test

      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(tapRes.status).toBe(400);
    });

    it("lists sessions for the company with computed state included", async () => {
      const res = await request(app).get("/api/attendance-sessions").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
      const entry = res.body.find((s: { id: string }) => s.id === sessionId);
      expect(entry).toBeTruthy();
      expect(entry.state).toBeDefined();
    });

    it("a second schedule on the same encoder is entirely independent — the encoder is open if either one is", async () => {
      // sessionId ("CS101 Lecture") is currently closed (scheduled_closed,
      // from the earlier test). A second, always-open schedule on the SAME
      // encoder should make attendance work again — like two different
      // courses sharing one room's reader.
      const secondRes = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId: sessionEncoderId, label: "MATH201 Lecture", daysOfWeek: [] });
      expect(secondRes.status).toBe(201);
      const secondId = secondRes.body.id;

      const listRes = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: sessionEncoderId });
      expect(listRes.body).toHaveLength(2);

      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(tapRes.status).toBe(201); // open because of MATH201, despite CS101 still being closed

      // Stopping MATH201 leaves the encoder fully closed again (CS101 is
      // still scheduled_closed), proving the two schedules don't share state.
      await request(app)
        .patch(`/api/attendance-sessions/${secondId}/override`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ manualOverride: "FORCE_CLOSED" });

      const blockedTapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(blockedTapRes.status).toBe(400);

      // Editing CS101 (sessionId) doesn't touch MATH201 (secondId).
      await request(app)
        .patch(`/api/attendance-sessions/${sessionId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ description: "Updated room: 305" });
      const secondAfterEdit = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: sessionEncoderId });
      const stillThere = secondAfterEdit.body.find((s: { id: string }) => s.id === secondId);
      expect(stillThere.label).toBe("MATH201 Lecture"); // unaffected by CS101's edit
      expect(stillThere.manualOverride).toBe("FORCE_CLOSED"); // unaffected too

      // Deleting MATH201 leaves CS101 alone and still enforced.
      const delRes = await request(app)
        .delete(`/api/attendance-sessions/${secondId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(delRes.status).toBe(204);

      const finalList = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: sessionEncoderId });
      expect(finalList.body).toHaveLength(1);
      expect(finalList.body[0].id).toBe(sessionId);
    });

    it("deleting the last schedule makes the encoder unrestricted again", async () => {
      const delRes = await request(app)
        .delete(`/api/attendance-sessions/${sessionId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(delRes.status).toBe(204);

      const listRes = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: sessionEncoderId });
      expect(listRes.body).toEqual([]);

      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: sessionCardId, encoderId: sessionEncoderId });
      expect(tapRes.status).toBe(201);
    });
  });

  describe("attendance sessions: startDate/endDate — Google-Calendar-style \"repeat weekly until <date>\"", () => {
    let dateRangeEncoderId: string;

    beforeAll(async () => {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Date Range Test Encoder", type: "ACR122U" });
      dateRangeEncoderId = encoderRes.body.id;
    });

    it("rejects creating a schedule whose endDate is before its startDate", async () => {
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          encoderId: dateRangeEncoderId,
          label: "Bad Range",
          daysOfWeek: [],
          startDate: "2026-06-01",
          endDate: "2026-01-01",
        });
      expect(res.status).toBe(400);
    });

    it("a schedule with a future startDate reports scheduled_closed even with no days/time restriction", async () => {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          encoderId: dateRangeEncoderId,
          label: "Next Year's Course",
          daysOfWeek: [],
          startDate: farFuture,
        });
      expect(res.status).toBe(201);
      expect(res.body.startDate).toBe(farFuture);
      expect(res.body.state.isOpen).toBe(false);
      expect(res.body.state.reason).toBe("scheduled_closed");
      expect(res.body.state.nextBoundaryAt).not.toBeNull();

      const tapCardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04D3000001", cardType: "NTAG213" });
      const tapRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: tapCardRes.body.id, encoderId: dateRangeEncoderId });
      expect(tapRes.status).toBe(400); // no other schedule is open on this fresh encoder
    });

    it("a schedule whose endDate has already passed reports scheduled_closed with no countdown", async () => {
      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          encoderId: dateRangeEncoderId,
          label: "Last Year's Course",
          daysOfWeek: [],
          endDate: "2020-01-01",
        });
      expect(res.status).toBe(201);
      expect(res.body.state).toEqual({ isOpen: false, reason: "scheduled_closed", nextBoundaryAt: null });
    });

    it("PATCH can set, and later clear, a schedule's date range", async () => {
      const createRes = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId: dateRangeEncoderId, label: "Semester Course", daysOfWeek: [] });
      const id = createRes.body.id;
      expect(createRes.body.startDate).toBeNull();
      expect(createRes.body.endDate).toBeNull();

      const setRes = await request(app)
        .patch(`/api/attendance-sessions/${id}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ startDate: "2020-01-01", endDate: "2020-06-01" });
      expect(setRes.status).toBe(200);
      expect(setRes.body.startDate).toBe("2020-01-01");
      expect(setRes.body.endDate).toBe("2020-06-01");
      expect(setRes.body.state.isOpen).toBe(false); // that semester is long over

      const clearRes = await request(app)
        .patch(`/api/attendance-sessions/${id}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ startDate: null, endDate: null });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body.startDate).toBeNull();
      expect(clearRes.body.endDate).toBeNull();
      expect(clearRes.body.state.reason).toBe("no_schedule"); // unrestricted again
    });

    it("rejects a PATCH that would leave startDate after endDate, even when only one side is in the request body", async () => {
      // The request-body-only .refine() can't see this on its own — a PATCH
      // touching just one side must be checked against the OTHER side's
      // already-stored value, or two separate innocent-looking requests
      // could together leave the schedule permanently misconfigured.
      const createRes = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId: dateRangeEncoderId, label: "Cross-Patch Course", daysOfWeek: [], endDate: "2026-01-01" });
      const id = createRes.body.id;

      const res = await request(app)
        .patch(`/api/attendance-sessions/${id}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ startDate: "2026-06-01" }); // endDate not mentioned, but already stored as 2026-01-01
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/endDate must be on or after startDate/i);

      // The schedule itself must be unaffected by the rejected PATCH.
      const unchanged = await request(app)
        .get("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ encoderId: dateRangeEncoderId });
      const entry = unchanged.body.find((s: { id: string }) => s.id === id);
      expect(entry.startDate).toBeNull();
      expect(entry.endDate).toBe("2026-01-01");
    });
  });

  describe("attendance modes: check-in only / check-out only / once / free", () => {
    async function newHolderAndCard(uid: string): Promise<string> {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: `Mode Test Holder ${uid}` });
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid, cardType: "NTAG213" });
      await request(app)
        .post(`/api/cards/${cardRes.body.id}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });
      return cardRes.body.id;
    }

    // A dedicated encoder per schedule keeps each test's mode isolated —
    // computeEncoderOpenState picks whichever schedule is open first among
    // ALL of an encoder's schedules, so sharing one encoder across tests
    // would let an earlier test's still-open schedule win instead of the
    // one this test just created. daysOfWeek: [] means "no_schedule" —
    // always open — so each test only exercises the mode itself, not the
    // schedule window.
    async function newSchedule(mode: string): Promise<{ sessionId: string; encoderId: string }> {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: `Mode Test Encoder ${mode} ${Math.random().toString(36).slice(2, 8)}`, type: "ACR122U" });
      const encoderId = encoderRes.body.id;

      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId, label: `Mode Test ${mode}`, daysOfWeek: [], mode });
      expect(res.status).toBe(201);
      expect(res.body.mode).toBe(mode);
      return { sessionId: res.body.id, encoderId };
    }

    it("defaults new schedules to FREE, unlimited alternation", async () => {
      const { sessionId, encoderId } = await newSchedule("FREE");
      const cardId = await newHolderAndCard("04D1000001");

      const first = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(first.body.type).toBe("CHECK_IN");
      expect(first.body.sessionId).toBe(sessionId);

      const second = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(second.body.type).toBe("CHECK_OUT");

      const third = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(third.status).toBe(201); // FREE keeps alternating indefinitely
      expect(third.body.type).toBe("CHECK_IN");
    });

    it("CHECK_IN_ONLY records a single check-in, then rejects a repeat tap from the same card", async () => {
      const { encoderId } = await newSchedule("CHECK_IN_ONLY");
      const cardId = await newHolderAndCard("04D1000002");

      const first = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(first.status).toBe(201);
      expect(first.body.type).toBe("CHECK_IN");

      const second = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(second.status).toBe(400);
      expect(second.body.error).toMatch(/already checked in/i);
    });

    it("CHECK_OUT_ONLY records a single check-out, then rejects a repeat tap from the same card", async () => {
      const { encoderId } = await newSchedule("CHECK_OUT_ONLY");
      const cardId = await newHolderAndCard("04D1000003");

      const first = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(first.status).toBe(201);
      expect(first.body.type).toBe("CHECK_OUT");

      const second = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(second.status).toBe(400);
      expect(second.body.error).toMatch(/already checked out/i);
    });

    it("ONCE allows exactly one check-in and one check-out, then rejects a third tap", async () => {
      const { encoderId } = await newSchedule("ONCE");
      const cardId = await newHolderAndCard("04D1000004");

      const first = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(first.status).toBe(201);
      expect(first.body.type).toBe("CHECK_IN");

      const second = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(second.status).toBe(201);
      expect(second.body.type).toBe("CHECK_OUT");

      const third = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(third.status).toBe(400);
      expect(third.body.error).toMatch(/already checked in and out/i);
    });

    it("a mode is scoped per holder — a different card is unaffected by another's CHECK_IN_ONLY limit", async () => {
      const { encoderId } = await newSchedule("CHECK_IN_ONLY");
      const cardA = await newHolderAndCard("04D1000005");
      const cardB = await newHolderAndCard("04D1000006");

      const aFirst = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardA, encoderId });
      expect(aFirst.status).toBe(201);

      const bFirst = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardB, encoderId });
      expect(bFirst.status).toBe(201); // a fresh holder, not blocked by A's check-in
    });

    it("can update a schedule's mode after creation via PATCH", async () => {
      const { sessionId } = await newSchedule("FREE");
      const patchRes = await request(app)
        .patch(`/api/attendance-sessions/${sessionId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ mode: "CHECK_IN_ONLY" });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.mode).toBe("CHECK_IN_ONLY");
    });

    it("DAILY_CHECK_IN records a check-in, then rejects a repeat tap the same day — no check-out concept", async () => {
      const { encoderId } = await newSchedule("DAILY_CHECK_IN");
      const cardId = await newHolderAndCard("04D1000007");

      const first = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(first.status).toBe(201);
      expect(first.body.type).toBe("CHECK_IN");

      const second = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(second.status).toBe(400);
      expect(second.body.error).toMatch(/already checked in/i);
    });

    it("DAILY_CHECK_IN: MCT101 meets Monday and Tuesday — closing Monday's session lets Tuesday's tap check in fresh", async () => {
      // Reproduces the reported course-attendance scenario directly: a
      // schedule that meets on multiple days should record a fresh
      // check-in each meeting, not read a previous meeting's check-in as
      // "already checked in" or (under FREE) flip the second tap into a
      // check-out. Each meeting is a SessionOccurrence — Monday's tap opens
      // one automatically; closing it (the "Close session" action an
      // operator uses at the end of class) is what lets Tuesday's tap open
      // a fresh occurrence instead of colliding with Monday's.
      const { sessionId, encoderId } = await newSchedule("DAILY_CHECK_IN");
      const cardId = await newHolderAndCard("04D1000008");

      const mondayTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(mondayTap.status).toBe(201);
      expect(mondayTap.body.type).toBe("CHECK_IN");

      const closeRes = await request(app)
        .post(`/api/attendance-sessions/${sessionId}/occurrences/close`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.isOpen).toBe(false);

      const tuesdayTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(tuesdayTap.status).toBe(201);
      expect(tuesdayTap.body.type).toBe("CHECK_IN"); // fresh occurrence, not rejected and not a check-out
      expect(tuesdayTap.body.sessionId).toBe(sessionId);
    });

    it("DAILY_CHECK_IN auto-rolls to a fresh occurrence on a new calendar day even if nobody clicked Close", async () => {
      // The bug this test guards against: an earlier version of the
      // occurrence logic only ever reused-or-created based on closedAt,
      // with no day-boundary awareness at all — a schedule meeting on
      // multiple days would silently reject every day after the first
      // unless an operator remembered to visit the Sessions panel and
      // click Close. Day-to-day reset must work with zero manual action;
      // Close/Reopen/Create-new remain available as explicit overrides on
      // top of that, not as a requirement for the common case.
      const { sessionId, encoderId } = await newSchedule("DAILY_CHECK_IN");
      const cardId = await newHolderAndCard("04D100000B");

      const dayOneTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(dayOneTap.status).toBe(201);
      const dayOneOccurrenceId = dayOneTap.body.occurrenceId;

      // Simulate "yesterday" by backdating the occurrence itself (not the
      // record) — nobody closed it, exactly the scenario the fix covers.
      await prisma.sessionOccurrence.update({
        where: { id: dayOneOccurrenceId },
        data: { openedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const dayTwoTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(dayTwoTap.status).toBe(201); // not rejected as "already checked in", with no manual Close call
      expect(dayTwoTap.body.type).toBe("CHECK_IN");
      expect(dayTwoTap.body.occurrenceId).not.toBe(dayOneOccurrenceId);

      const occurrences = await request(app)
        .get(`/api/attendance-sessions/${sessionId}/occurrences`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      const dayOne = occurrences.body.find((o: { id: string }) => o.id === dayOneOccurrenceId);
      expect(dayOne.isOpen).toBe(false); // auto-closed by the rollover, not left dangling open
      const openOnes = occurrences.body.filter((o: { isOpen: boolean }) => o.isOpen);
      expect(openOnes).toHaveLength(1);
      expect(openOnes[0].id).toBe(dayTwoTap.body.occurrenceId);
    });

    it("FREE mode never creates a SessionOccurrence — occurrence bookkeeping is DAILY_CHECK_IN-only", async () => {
      const { sessionId, encoderId } = await newSchedule("FREE");
      const cardId = await newHolderAndCard("04D100000C");

      const tap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(tap.status).toBe(201);
      expect(tap.body.occurrenceId).toBeFalsy();

      const occurrences = await request(app)
        .get(`/api/attendance-sessions/${sessionId}/occurrences`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(occurrences.body).toEqual([]);
    });

    it("a schedule's non-FREE mode is scoped to that schedule, not the zone it shares with another schedule", async () => {
      // The root-cause fix for "I open a new schedule and it says I'm
      // already checked in": CHECK_IN_ONLY/CHECK_OUT_ONLY/ONCE/DAILY_CHECK_IN
      // are scoped per-schedule (sessionId), not per-zone, specifically so
      // two different schedules sharing a zone (or both "General") don't
      // inherit each other's state.
      const zoneRes = await request(app)
        .post("/api/zones")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Shared Mode Test Zone" });
      const zoneId = zoneRes.body.id;

      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Shared Mode Test Encoder", type: "ACR122U" });
      const encoderId = encoderRes.body.id;

      const scheduleA = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId, zoneId, label: "Schedule A", daysOfWeek: [], mode: "CHECK_IN_ONLY" });
      expect(scheduleA.status).toBe(201);

      const cardId = await newHolderAndCard("04D1000009");

      // Use up A's CHECK_IN_ONLY limit (daysOfWeek: [] means always open).
      const aTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId, zoneId });
      expect(aTap.status).toBe(201);
      await request(app)
        .patch(`/api/attendance-sessions/${scheduleA.body.id}/override`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ manualOverride: "FORCE_CLOSED" });

      // A brand-new schedule B, same zone, same encoder, also CHECK_IN_ONLY —
      // its own tap must succeed fresh, unaffected by A's already-used limit.
      const scheduleB = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId, zoneId, label: "Schedule B", daysOfWeek: [], mode: "CHECK_IN_ONLY" });
      expect(scheduleB.status).toBe(201);

      const bTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId, zoneId });
      expect(bTap.status).toBe(201); // not blocked by A's state, despite sharing the zone
      expect(bTap.body.type).toBe("CHECK_IN");
      expect(bTap.body.sessionId).toBe(scheduleB.body.id);
    });
  });

  describe("session occurrences: close / reopen / create-new (per-schedule session lifecycle)", () => {
    async function newHolderAndCard(uid: string): Promise<string> {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: `Occurrence Test Holder ${uid}` });
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid, cardType: "NTAG213" });
      await request(app)
        .post(`/api/cards/${cardRes.body.id}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });
      return cardRes.body.id;
    }

    async function newSchedule(mode: string): Promise<{ sessionId: string; encoderId: string }> {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: `Occurrence Test Encoder ${mode} ${Math.random().toString(36).slice(2, 8)}`, type: "ACR122U" });
      const encoderId = encoderRes.body.id;

      const res = await request(app)
        .post("/api/attendance-sessions")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderId, label: `Occurrence Test ${mode}`, daysOfWeek: [], mode });
      expect(res.status).toBe(201);
      return { sessionId: res.body.id, encoderId };
    }

    it("closing has nothing to close on a schedule with no taps yet", async () => {
      const { sessionId } = await newSchedule("DAILY_CHECK_IN");
      const res = await request(app)
        .post(`/api/attendance-sessions/${sessionId}/occurrences/close`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no open session/i);
    });

    it("lists occurrences newest-first with a record count and open flag", async () => {
      const { sessionId, encoderId } = await newSchedule("DAILY_CHECK_IN");
      const cardId = await newHolderAndCard("04D2000001");

      const tap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(tap.status).toBe(201);

      const listRes = await request(app)
        .get(`/api/attendance-sessions/${sessionId}/occurrences`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toMatchObject({ isOpen: true, recordCount: 1 });
    });

    it("create-new-session closes whatever was open and starts an independent fresh one", async () => {
      const { sessionId, encoderId } = await newSchedule("DAILY_CHECK_IN");
      const cardId = await newHolderAndCard("04D2000002");

      const firstTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(firstTap.status).toBe(201);

      const createRes = await request(app)
        .post(`/api/attendance-sessions/${sessionId}/occurrences`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(createRes.status).toBe(201);
      expect(createRes.body.isOpen).toBe(true);
      expect(createRes.body.id).not.toBe(firstTap.body.occurrenceId);

      // Same card can check in again — it's a fresh occurrence, no stale state.
      const secondTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId, encoderId });
      expect(secondTap.status).toBe(201);
      expect(secondTap.body.type).toBe("CHECK_IN");

      const listRes = await request(app)
        .get(`/api/attendance-sessions/${sessionId}/occurrences`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(listRes.body).toHaveLength(2);
      const openOnes = listRes.body.filter((o: { isOpen: boolean }) => o.isOpen);
      expect(openOnes).toHaveLength(1); // at most one open occurrence at a time
    });

    it("reopening a past occurrence closes the current one and lets new taps attach to the reopened one", async () => {
      const { sessionId, encoderId } = await newSchedule("DAILY_CHECK_IN");
      const cardA = await newHolderAndCard("04D2000003");
      const cardB = await newHolderAndCard("04D2000004");

      const firstTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardA, encoderId });
      expect(firstTap.status).toBe(201);
      const firstOccurrenceId = firstTap.body.occurrenceId;

      await request(app)
        .post(`/api/attendance-sessions/${sessionId}/occurrences/close`)
        .set("Authorization", `Bearer ${companyAdminToken}`);

      // A late tap opens a new second occurrence.
      const secondTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardB, encoderId });
      expect(secondTap.status).toBe(201);
      expect(secondTap.body.occurrenceId).not.toBe(firstOccurrenceId);

      // Reopen the first occurrence — e.g. a forgotten card holder shows up
      // late and should be recorded against the original meeting, not a new one.
      const reopenRes = await request(app)
        .post(`/api/attendance-sessions/${sessionId}/occurrences/${firstOccurrenceId}/reopen`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.isOpen).toBe(true);

      const listRes = await request(app)
        .get(`/api/attendance-sessions/${sessionId}/occurrences`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      const openOnes = listRes.body.filter((o: { isOpen: boolean }) => o.isOpen);
      expect(openOnes).toHaveLength(1);
      expect(openOnes[0].id).toBe(firstOccurrenceId); // reopening auto-closed the second one

      // cardA (already checked in on the first occurrence) is rejected again,
      // proving the new tap really did land back on the reopened occurrence.
      const rejectedTap = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardA, encoderId });
      expect(rejectedTap.status).toBe(400);
    });

    it("rejects a VIEWER from closing a session", async () => {
      const { sessionId } = await newSchedule("DAILY_CHECK_IN");
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "viewer-occurrencetest@integration-test-co.example",
          password: "ViewerOnly123!",
          fullName: "Occurrence Test Viewer",
          role: "VIEWER",
          companyId,
        });
      const viewerToken = await loginAs("viewer-occurrencetest@integration-test-co.example", "ViewerOnly123!");

      const closeRes = await request(app)
        .post(`/api/attendance-sessions/${sessionId}/occurrences/close`)
        .set("Authorization", `Bearer ${viewerToken}`);
      expect(closeRes.status).toBe(403);
    });
  });

  describe("card data deletion: clear-write role gate + audit logging", () => {
    let clearEncoderId: string;
    let clearCardId: string;
    let agentSocket: ClientSocket;
    let managerToken: string;
    let operatorToken: string;
    let viewerToken: string;

    async function connectDashboard(token: string): Promise<ClientSocket> {
      const socket = ioClient(`http://127.0.0.1:${env.port}/dashboard`, { auth: { token }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", reject);
      });
      return socket;
    }

    function sendCommand(socket: ClientSocket, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; commandId?: string }> {
      return new Promise((resolve) => socket.emit("encoder:command", body, resolve));
    }

    beforeAll(async () => {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Clear Write Test Encoder", type: "ACR122U" });
      clearEncoderId = encoderRes.body.id;

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04C1EA2000", cardType: "MIFARE_CLASSIC_1K" });
      clearCardId = cardRes.body.id;

      // A real fake agent (not just an ONLINE status flip) so a WRITE_BLOCK
      // can complete a full round trip — needed to exercise the
      // COMMAND_TO_OPERATION audit-log mapping below, not just the ack.
      agentSocket = ioClient(`http://127.0.0.1:${env.port}/agent`, { auth: { agentKey: encoderRes.body.agentKey }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        agentSocket.on("connect", () => resolve());
        agentSocket.on("connect_error", reject);
      });
      agentSocket.on("command", (payload: { commandId: string; command: string }) => {
        agentSocket.emit("command:result", {
          commandId: payload.commandId,
          command: payload.command,
          success: true,
          data: { block: 4, data: "00".repeat(16) },
        });
      });

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "manager-cleartest@integration-test-co.example",
          password: "ManagerOnly123!",
          fullName: "Integration Manager",
          role: "MANAGER",
          companyId,
        });
      managerToken = await loginAs("manager-cleartest@integration-test-co.example", "ManagerOnly123!");

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "operator-cleartest@integration-test-co.example",
          password: "OperatorOnly123!",
          fullName: "Integration Operator",
          role: "OPERATOR",
          companyId,
        });
      operatorToken = await loginAs("operator-cleartest@integration-test-co.example", "OperatorOnly123!");

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "viewer-cleartest@integration-test-co.example",
          password: "ViewerOnly123!",
          fullName: "Integration Viewer",
          role: "VIEWER",
          companyId,
        });
      viewerToken = await loginAs("viewer-cleartest@integration-test-co.example", "ViewerOnly123!");
    });

    afterAll(() => {
      agentSocket?.close();
    });

    it("rejects a clear-write (args.clear=true) from an OPERATOR", async () => {
      const socket = await connectDashboard(operatorToken);
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: clearCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A", clear: true },
      });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/permission/i);
    });

    it("an OPERATOR can still do an ordinary (non-clear) write", async () => {
      const socket = await connectDashboard(operatorToken);
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: clearCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "41424344000000000000000000000000".slice(0, 32), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(true);
    });

    it("rejects an ordinary (non-clear) write from a VIEWER, unlike an OPERATOR", async () => {
      const socket = await connectDashboard(viewerToken);
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: clearCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "41424344000000000000000000000000".slice(0, 32), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/permission/i);
    });

    it("still allows a VIEWER to send a read-only command", async () => {
      const socket = await connectDashboard(viewerToken);
      const ack = await sendCommand(socket, { encoderId: clearEncoderId, command: "READ_UID" });
      socket.close();
      expect(ack.ok).toBe(true);
    });

    it("rejects an encoder:command referencing another company's card, even for the caller's own encoder", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Websocket Test Other Co", slug: "websocket-test-other-co" });
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: "admin@websocket-test-other-co.example",
          password: "OtherAdmin123!",
          fullName: "Websocket Test Other Admin",
          role: "COMPANY_ADMIN",
          companyId: otherCompanyRes.body.id,
        });
      const otherAdminToken = await loginAs("admin@websocket-test-other-co.example", "OtherAdmin123!");
      const otherCardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .send({ uid: "04B0AC3000", cardType: "NTAG213" });

      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: otherCardRes.body.id,
        command: "READ_UID",
      });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/forbidden/i);
    });

    it("rejects a WRITE_BLOCK targeting the manufacturer block, even for a MANAGER", async () => {
      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: clearCardId,
        command: "WRITE_BLOCK",
        args: { block: 0, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/protected/i);
    });

    it("rejects a WRITE_BLOCK targeting a sector trailer, even for a MANAGER", async () => {
      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: clearCardId,
        command: "WRITE_BLOCK",
        args: { block: 7, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/protected/i);
    });

    it("allows a clear-write from a MANAGER, and logs it as WRITE (not READ) in the audit trail", async () => {
      const socket = await connectDashboard(managerToken);
      const commandResult = new Promise<void>((resolve) => {
        socket.on("encoder:commandResult", () => resolve());
      });
      const ack = await sendCommand(socket, {
        encoderId: clearEncoderId,
        cardId: clearCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A", clear: true },
      });
      expect(ack.ok).toBe(true);
      await commandResult;
      socket.close();

      // logOperation is awaited server-side after the commandResult broadcast
      // fires, so there's a small window where the row isn't written yet —
      // poll briefly rather than asserting immediately.
      let entry: { operationType: string; card?: { id: string }; user?: { id: string } } | undefined;
      for (let attempt = 0; attempt < 10 && !entry; attempt++) {
        const logsRes = await request(app)
          .get("/api/logs")
          .set("Authorization", `Bearer ${companyAdminToken}`)
          .query({ cardId: clearCardId, encoderId: clearEncoderId, pageSize: 10 });
        entry = logsRes.body.data[0];
        if (!entry) await new Promise((r) => setTimeout(r, 50));
      }
      expect(entry).toBeTruthy();
      // Both were previously missing from this log path entirely: the
      // command:result handler never threaded cardId/userId through from
      // the original dispatch, so a "delete card data" action couldn't be
      // traced back to which card or who performed it.
      expect(entry?.card?.id).toBe(clearCardId);
      expect(entry?.user?.id).toBeTruthy();
      expect(entry?.operationType).toBe("WRITE"); // was falling through to the "READ" default before the COMMAND_TO_OPERATION fix
    });
  });

  describe("write-protected cards: block writes without touching card status", () => {
    let wpEncoderId: string;
    let wpCardId: string;
    let agentSocket: ClientSocket;
    let managerToken: string;
    let operatorToken: string;

    async function connectDashboard(token: string): Promise<ClientSocket> {
      const socket = ioClient(`http://127.0.0.1:${env.port}/dashboard`, { auth: { token }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", reject);
      });
      return socket;
    }

    function sendCommand(socket: ClientSocket, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; commandId?: string }> {
      return new Promise((resolve) => socket.emit("encoder:command", body, resolve));
    }

    beforeAll(async () => {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Write Protect Test Encoder", type: "ACR122U" });
      wpEncoderId = encoderRes.body.id;

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04AACC0001", cardType: "NTAG213" });
      wpCardId = cardRes.body.id;

      // Just enough of a fake agent to bring the encoder ONLINE — the
      // write-protected check rejects before a command is ever dispatched to
      // it, so it doesn't need to actually answer anything.
      agentSocket = ioClient(`http://127.0.0.1:${env.port}/agent`, { auth: { agentKey: encoderRes.body.agentKey }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        agentSocket.on("connect", () => resolve());
        agentSocket.on("connect_error", reject);
      });

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "manager-writeprotect@integration-test-co.example",
          password: "ManagerOnly123!",
          fullName: "Write Protect Manager",
          role: "MANAGER",
          companyId,
        });
      managerToken = await loginAs("manager-writeprotect@integration-test-co.example", "ManagerOnly123!");

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "operator-writeprotect@integration-test-co.example",
          password: "OperatorOnly123!",
          fullName: "Write Protect Operator",
          role: "OPERATOR",
          companyId,
        });
      operatorToken = await loginAs("operator-writeprotect@integration-test-co.example", "OperatorOnly123!");
    });

    afterAll(() => {
      agentSocket?.close();
    });

    it("rejects write-protect from an OPERATOR — MANAGER_UP only, same tier as block/unblock", async () => {
      const res = await request(app)
        .post(`/api/cards/${wpCardId}/write-protect`)
        .set("Authorization", `Bearer ${operatorToken}`);
      expect(res.status).toBe(403);
    });

    it("write-protects a card and blocks a write over the websocket", async () => {
      const res = await request(app)
        .post(`/api/cards/${wpCardId}/write-protect`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.writeProtected).toBe(true);
      expect(res.body.status).toBe("UNASSIGNED"); // status itself is untouched

      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, {
        encoderId: wpEncoderId,
        cardId: wpCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/write-protected/i);
    });

    it("still allows a READ on a write-protected card", async () => {
      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, { encoderId: wpEncoderId, cardId: wpCardId, command: "READ_UID" });
      socket.close();
      expect(ack.ok).toBe(true);
    });

    it("still allows attendance taps on a write-protected card", async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Write Protect Test Holder" });
      await request(app)
        .post(`/api/cards/${wpCardId}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });

      const res = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: wpCardId });
      expect(res.status).toBe(201);
    });

    it("removes write protection and allows writes again", async () => {
      const unprotectRes = await request(app)
        .post(`/api/cards/${wpCardId}/write-unprotect`)
        .set("Authorization", `Bearer ${managerToken}`);
      expect(unprotectRes.status).toBe(200);
      expect(unprotectRes.body.writeProtected).toBe(false);

      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, {
        encoderId: wpEncoderId,
        cardId: wpCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(true);
    });

    it("the generic PATCH /cards/:id cannot set writeProtected — only the dedicated endpoints can", async () => {
      const res = await request(app)
        .patch(`/api/cards/${wpCardId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ writeProtected: true, label: "still works" });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe("still works");
      expect(res.body.writeProtected).toBe(false); // unrecognized field silently stripped by the Zod schema
    });
  });

  describe("random key generation: blocked while write-protected (would strand the card otherwise)", () => {
    let keyGenCardId: string;

    beforeAll(async () => {
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04AACC0002", cardType: "MIFARE_CLASSIC_1K" });
      keyGenCardId = cardRes.body.id;
    });

    it("generates keys normally on an unprotected card", async () => {
      const res = await request(app)
        .post(`/api/cards/${keyGenCardId}/keys/generate`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.keys).toBeTruthy();

      const cardRes = await request(app).get(`/api/cards/${keyGenCardId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(cardRes.body.hasStoredKeys).toBe(true);
    });

    it("rejects generating a new key while the card is write-protected", async () => {
      await request(app).post(`/api/cards/${keyGenCardId}/write-protect`).set("Authorization", `Bearer ${companyAdminToken}`);

      const res = await request(app)
        .post(`/api/cards/${keyGenCardId}/keys/generate`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/write-protect/i);
    });

    it("allows key generation again once write protection is removed", async () => {
      await request(app).post(`/api/cards/${keyGenCardId}/write-unprotect`).set("Authorization", `Bearer ${companyAdminToken}`);

      const res = await request(app)
        .post(`/api/cards/${keyGenCardId}/keys/generate`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe("hasStoredKeys is reported consistently everywhere a card is returned, not just GET /cards/:id", () => {
    // Regression coverage: GET /api/cards (list/search — what Live Encode's
    // tap-detection lookup actually calls, never GET /cards/:id) used to
    // strip keysEncrypted without ever adding hasStoredKeys back, so every
    // card looked up that way silently reported "no key" even when one was
    // stored — breaking the write-protect key-generation guard and the
    // "no key yet" banners for the one flow (a real card tap) they exist for.
    let hskCardId: string;

    beforeAll(async () => {
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04AACC0003", cardType: "MIFARE_CLASSIC_1K" });
      hskCardId = cardRes.body.id;
      await request(app).post(`/api/cards/${hskCardId}/keys/generate`).set("Authorization", `Bearer ${companyAdminToken}`);
    });

    it("GET /api/cards (list/search) reports hasStoredKeys: true for a card with keys", async () => {
      const res = await request(app)
        .get("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ search: "04AACC0003", pageSize: 5 });
      expect(res.status).toBe(200);
      const found = res.body.data.find((c: { id: string }) => c.id === hskCardId);
      expect(found).toBeTruthy();
      expect(found.hasStoredKeys).toBe(true);
      expect(found.keysEncrypted).toBeUndefined(); // never leaks the raw blob
    });

    it("every mutation endpoint that returns the updated card keeps reporting hasStoredKeys: true", async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "HasStoredKeys Test Holder" });

      const assignRes = await request(app)
        .post(`/api/cards/${hskCardId}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });
      expect(assignRes.body.hasStoredKeys).toBe(true);

      const updateRes = await request(app)
        .patch(`/api/cards/${hskCardId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ label: "HSK Test" });
      expect(updateRes.body.hasStoredKeys).toBe(true);

      const blockRes = await request(app)
        .post(`/api/cards/${hskCardId}/block`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(blockRes.body.hasStoredKeys).toBe(true);
    });
  });

  describe("lifecycle-locked cards (BLOCKED/LOST/RETIRED/EXPIRED): reads still work, writes don't", () => {
    let lifecycleEncoderId: string;
    let lifecycleCardId: string;
    let agentSocket: ClientSocket;
    let managerToken: string;

    async function connectDashboard(token: string): Promise<ClientSocket> {
      const socket = ioClient(`http://127.0.0.1:${env.port}/dashboard`, { auth: { token }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", reject);
      });
      return socket;
    }

    function sendCommand(socket: ClientSocket, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; commandId?: string }> {
      return new Promise((resolve) => socket.emit("encoder:command", body, resolve));
    }

    beforeAll(async () => {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Lifecycle Lock Test Encoder", type: "ACR122U" });
      lifecycleEncoderId = encoderRes.body.id;

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04AC000001", cardType: "NTAG213" });
      lifecycleCardId = cardRes.body.id;

      agentSocket = ioClient(`http://127.0.0.1:${env.port}/agent`, { auth: { agentKey: encoderRes.body.agentKey }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        agentSocket.on("connect", () => resolve());
        agentSocket.on("connect_error", reject);
      });

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "manager-lifecyclelock@integration-test-co.example",
          password: "ManagerOnly123!",
          fullName: "Lifecycle Lock Manager",
          role: "MANAGER",
          companyId,
        });
      managerToken = await loginAs("manager-lifecyclelock@integration-test-co.example", "ManagerOnly123!");
    });

    afterAll(() => {
      agentSocket?.close();
    });

    it("a BLOCKED card can still be read but not written to over the websocket", async () => {
      await request(app).post(`/api/cards/${lifecycleCardId}/block`).set("Authorization", `Bearer ${managerToken}`);

      const socket = await connectDashboard(managerToken);
      const readAck = await sendCommand(socket, { encoderId: lifecycleEncoderId, cardId: lifecycleCardId, command: "READ_UID" });
      const writeAck = await sendCommand(socket, {
        encoderId: lifecycleEncoderId,
        cardId: lifecycleCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();

      expect(readAck.ok).toBe(true);
      expect(writeAck.ok).toBe(false);
      expect(writeAck.error).toMatch(/blocked and cannot be written to/i);

      await request(app).post(`/api/cards/${lifecycleCardId}/unblock`).set("Authorization", `Bearer ${managerToken}`);
    });

    it("a RETIRED card can still be read but not written to over the websocket", async () => {
      await request(app).post(`/api/cards/${lifecycleCardId}/retire`).set("Authorization", `Bearer ${managerToken}`);

      const socket = await connectDashboard(managerToken);
      const readAck = await sendCommand(socket, { encoderId: lifecycleEncoderId, cardId: lifecycleCardId, command: "READ_UID" });
      const writeAck = await sendCommand(socket, {
        encoderId: lifecycleEncoderId,
        cardId: lifecycleCardId,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();

      expect(readAck.ok).toBe(true);
      expect(writeAck.ok).toBe(false);
      expect(writeAck.error).toMatch(/retired and cannot be written to/i);
    });

    it("an ACTIVE card allows writes normally — the lock is opt-in per lifecycle status, not a default restriction", async () => {
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04AC000002", cardType: "NTAG213" });

      const socket = await connectDashboard(managerToken);
      const ack = await sendCommand(socket, {
        encoderId: lifecycleEncoderId,
        cardId: cardRes.body.id,
        command: "WRITE_BLOCK",
        args: { block: 4, data: "00".repeat(16), key: "FFFFFFFFFFFF", keyType: "A" },
      });
      socket.close();
      expect(ack.ok).toBe(true);
    });
  });

  describe("hotel: time-limited encoder allocation", () => {
    let encoderAId: string;
    let encoderBId: string;
    let restrictedCardId: string;

    async function connectDashboard(token: string): Promise<ClientSocket> {
      const socket = ioClient(`http://127.0.0.1:${env.port}/dashboard`, { auth: { token }, forceNew: true });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", reject);
      });
      return socket;
    }

    function sendCommand(
      socket: ClientSocket,
      body: { encoderId: string; cardId: string; command: string }
    ): Promise<{ ok: boolean; error?: string }> {
      return new Promise((resolve) => socket.emit("encoder:command", body, resolve));
    }

    beforeAll(async () => {
      const encoderARes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Room Door Encoder", type: "ACR122U" });
      encoderAId = encoderARes.body.id;

      const encoderBRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Lobby Encoder", type: "ACR122U" });
      encoderBId = encoderBRes.body.id;

      // No real agent connects in this suite; mark both ONLINE directly so
      // the websocket handler's offline check doesn't short-circuit before
      // reaching the allocation logic under test.
      await prisma.encoder.updateMany({ where: { id: { in: [encoderAId, encoderBId] } }, data: { status: "ONLINE" } });

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04B0AC1000", cardType: "NTAG213" });
      restrictedCardId = cardRes.body.id;
    });

    it("grants an encoder allocation with a checkout-style expiry", async () => {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const res = await request(app)
        .post(`/api/cards/${restrictedCardId}/encoders/grant`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderIds: [encoderAId], expiresAt });
      expect(res.status).toBe(204);

      const getRes = await request(app)
        .get(`/api/cards/${restrictedCardId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(getRes.body.encoderAllocations).toHaveLength(1);
      expect(new Date(getRes.body.encoderAllocations[0].expiresAt).toISOString()).toBe(expiresAt);
    });

    it("re-granting the same encoder extends/replaces its expiry instead of no-op-ing", async () => {
      const laterExpiry = new Date(Date.now() + 3_600_000).toISOString();
      const res = await request(app)
        .post(`/api/cards/${restrictedCardId}/encoders/grant`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderIds: [encoderAId], expiresAt: laterExpiry });
      expect(res.status).toBe(204);

      const getRes = await request(app)
        .get(`/api/cards/${restrictedCardId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(getRes.body.encoderAllocations).toHaveLength(1); // still one row, not a duplicate
      expect(new Date(getRes.body.encoderAllocations[0].expiresAt).toISOString()).toBe(laterExpiry);
    });

    it("allows a live-encode command against the allocated, non-expired encoder", async () => {
      const socket = await connectDashboard(companyAdminToken);
      const ack = await sendCommand(socket, { encoderId: encoderAId, cardId: restrictedCardId, command: "READ" });
      socket.close();
      expect(ack.ok).toBe(true);
    });

    it("rejects a live-encode command against an encoder the card was never allocated to", async () => {
      const socket = await connectDashboard(companyAdminToken);
      const ack = await sendCommand(socket, { encoderId: encoderBId, cardId: restrictedCardId, command: "READ" });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/not allocated/i);
    });

    it("rejects a command once the allocation's expiry has passed, without falling back to unrestricted", async () => {
      await prisma.cardEncoderAllocation.update({
        where: { cardId_encoderId: { cardId: restrictedCardId, encoderId: encoderAId } },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const socket = await connectDashboard(companyAdminToken);
      const ack = await sendCommand(socket, { encoderId: encoderAId, cardId: restrictedCardId, command: "READ" });
      socket.close();
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/expired/i);
    });

    it("revoking the allocation returns the card to unrestricted use on any company encoder", async () => {
      await request(app)
        .post(`/api/cards/${restrictedCardId}/encoders/revoke`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderIds: [encoderAId] })
        .expect(204);

      const socket = await connectDashboard(companyAdminToken);
      const ack = await sendCommand(socket, { encoderId: encoderBId, cardId: restrictedCardId, command: "READ" });
      socket.close();
      expect(ack.ok).toBe(true);
    });
  });

  describe("access zones: editing, and tying cards + encoders", () => {
    let zoneId: string;
    let zoneEncoderId: string;
    let zoneCardId: string;

    beforeAll(async () => {
      const zoneRes = await request(app)
        .post("/api/zones")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Server Room", description: "Data center access" });
      zoneId = zoneRes.body.id;

      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Server Room Door Reader", type: "ACR122U" });
      zoneEncoderId = encoderRes.body.id;

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04B0AC2000", cardType: "NTAG213" });
      zoneCardId = cardRes.body.id;
    });

    it("lets a manager edit the zone's name and description", async () => {
      const res = await request(app)
        .patch(`/api/zones/${zoneId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Server Room (Renamed)", description: "Updated description" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Server Room (Renamed)");
      expect(res.body.description).toBe("Updated description");
    });

    it("ties an encoder to the zone", async () => {
      const res = await request(app)
        .post(`/api/zones/${zoneId}/grant-encoders`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderIds: [zoneEncoderId] });
      expect(res.status).toBe(204);
    });

    it("grants a card access to the zone", async () => {
      const res = await request(app)
        .post(`/api/zones/${zoneId}/grant`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardIds: [zoneCardId] });
      expect(res.status).toBe(204);
    });

    it("returns the tied encoder and granted card on the zone detail endpoint", async () => {
      const res = await request(app).get(`/api/zones/${zoneId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.encoders).toHaveLength(1);
      expect(res.body.encoders[0].encoder.id).toBe(zoneEncoderId);
      expect(res.body.cards).toHaveLength(1);
      expect(res.body.cards[0].card.id).toBe(zoneCardId);
    });

    it("reflects the encoder/card counts on the zone list endpoint", async () => {
      const res = await request(app).get("/api/zones").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
      const zone = res.body.find((z: { id: string }) => z.id === zoneId);
      expect(zone._count.encoders).toBe(1);
      expect(zone._count.cards).toBe(1);
    });

    it("rejects tying an encoder that belongs to a different company", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Zone Test Other Co", slug: "zone-test-other-co" });
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: "admin@zone-test-other-co.example",
          password: "OtherAdmin123!",
          fullName: "Zone Test Other Admin",
          role: "COMPANY_ADMIN",
          companyId: otherCompanyRes.body.id,
        });
      const otherAdminToken = await loginAs("admin@zone-test-other-co.example", "OtherAdmin123!");
      const otherEncoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .send({ name: "Other Co Encoder", type: "ACR122U" });

      const res = await request(app)
        .post(`/api/zones/${zoneId}/grant-encoders`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderIds: [otherEncoderRes.body.id] });
      expect(res.status).toBe(400);
    });

    it("unties the encoder from the zone", async () => {
      const res = await request(app)
        .post(`/api/zones/${zoneId}/revoke-encoders`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ encoderIds: [zoneEncoderId] });
      expect(res.status).toBe(204);

      const getRes = await request(app).get(`/api/zones/${zoneId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(getRes.body.encoders).toHaveLength(0);
    });
  });

  describe("industry & module gating", () => {
    it("self-registering with an industry seeds that industry's default modules, without CITIZEN_DATA", async () => {
      const res = await request(app).post("/api/auth/register-company").send({
        companyName: "Sunrise Boutique Hotel",
        slug: "sunrise-boutique-hotel",
        fullName: "Hotel Owner",
        email: "owner@sunrise-hotel.example",
        password: "HotelOwner123!",
        industry: "HOTEL",
      });
      expect(res.status).toBe(201);

      const token = await loginAs("owner@sunrise-hotel.example", "HotelOwner123!");
      const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(meRes.body.company.industry).toBe("HOTEL");
      expect(meRes.body.company.enabledModules).toEqual(
        expect.arrayContaining(["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"])
      );
      expect(meRes.body.company.enabledModules).not.toContain("CITIZEN_DATA");
    });

    it("self-registering with the GOVERNMENT_ID industry includes CITIZEN_DATA", async () => {
      const res = await request(app).post("/api/auth/register-company").send({
        companyName: "National Registry Office",
        slug: "national-registry-office",
        fullName: "Registrar",
        email: "registrar@nro.example",
        password: "Registrar123!",
        industry: "GOVERNMENT_ID",
      });
      expect(res.status).toBe(201);

      const token = await loginAs("registrar@nro.example", "Registrar123!");
      const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(meRes.body.company.enabledModules).toContain("CITIZEN_DATA");
    });

    it("self-registering with the INVENTORY industry gets the core modules, without CITIZEN_DATA", async () => {
      const res = await request(app).post("/api/auth/register-company").send({
        companyName: "Warehouse Assets Co",
        slug: "warehouse-assets-co",
        fullName: "Warehouse Manager",
        email: "manager@warehouse-assets.example",
        password: "Warehouse123!",
        industry: "INVENTORY",
      });
      expect(res.status).toBe(201);

      const token = await loginAs("manager@warehouse-assets.example", "Warehouse123!");
      const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(meRes.body.company.enabledModules).toEqual(
        expect.arrayContaining(["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"])
      );
      expect(meRes.body.company.enabledModules).not.toContain("CITIZEN_DATA");
    });

    it("self-registering with the HEALTHCARE industry includes CITIZEN_DATA", async () => {
      const res = await request(app).post("/api/auth/register-company").send({
        companyName: "City Clinic",
        slug: "city-clinic",
        fullName: "Clinic Admin",
        email: "admin@city-clinic.example",
        password: "CityClinic123!",
        industry: "HEALTHCARE",
      });
      expect(res.status).toBe(201);

      const token = await loginAs("admin@city-clinic.example", "CityClinic123!");
      const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(meRes.body.company.enabledModules).toContain("CITIZEN_DATA");
    });

    it("self-registering without an industry stays unrestricted (empty enabledModules)", async () => {
      const res = await request(app).post("/api/auth/register-company").send({
        companyName: "Generic Co",
        slug: "generic-co",
        fullName: "Generic Owner",
        email: "owner@generic-co.example",
        password: "GenericOwner123!",
      });
      expect(res.status).toBe(201);

      const token = await loginAs("owner@generic-co.example", "GenericOwner123!");
      const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(meRes.body.company.industry).toBeNull();
      expect(meRes.body.company.enabledModules).toEqual([]);
    });

    it("a SUPER_ADMIN creating a company with an industry gets that industry's defaults", async () => {
      const res = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "State University", slug: "state-university", industry: "UNIVERSITY" });
      expect(res.status).toBe(201);
      expect(res.body.enabledModules).toEqual(
        expect.arrayContaining(["CARDS", "ENCODERS", "TEMPLATES", "HOLDERS", "ZONES", "ATTENDANCE", "LOGS"])
      );
      expect(res.body.enabledModules).not.toContain("CITIZEN_DATA");
    });

    it("an explicit enabledModules list overrides the industry's defaults", async () => {
      const res = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Minimal Co", slug: "minimal-co", industry: "BUSINESS", enabledModules: ["CARDS"] });
      expect(res.status).toBe(201);
      expect(res.body.enabledModules).toEqual(["CARDS"]);
    });

    it("a COMPANY_ADMIN cannot grant their own company additional modules via update", async () => {
      const companyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Locked Down Co", slug: "locked-down-co", industry: "BUSINESS", enabledModules: ["CARDS"] });
      const lockedCompanyId = companyRes.body.id;

      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: "admin@locked-down-co.example",
          password: "LockedAdmin123!",
          fullName: "Locked Admin",
          role: "COMPANY_ADMIN",
          companyId: lockedCompanyId,
        });
      const lockedAdminToken = await loginAs("admin@locked-down-co.example", "LockedAdmin123!");

      const res = await request(app)
        .patch(`/api/companies/${lockedCompanyId}`)
        .set("Authorization", `Bearer ${lockedAdminToken}`)
        .send({ name: "Locked Down Co (renamed)", industry: "GOVERNMENT_ID", enabledModules: ["CITIZEN_DATA"] });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Locked Down Co (renamed)"); // allowed field still applies
      expect(res.body.industry).toBe("BUSINESS"); // gating fields silently ignored
      expect(res.body.enabledModules).toEqual(["CARDS"]);
    });

    it("a SUPER_ADMIN can change a company's industry and modules directly", async () => {
      const companyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Growing Co", slug: "growing-co" });
      const growingCompanyId = companyRes.body.id;
      expect(companyRes.body.enabledModules).toEqual([]);

      const res = await request(app)
        .patch(`/api/companies/${growingCompanyId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ industry: "GOVERNMENT_ID" });
      expect(res.status).toBe(200);
      expect(res.body.enabledModules).toContain("CITIZEN_DATA");
    });

    it("Hotel gets VISITORS by default, and Inventory/Business get MAINTENANCE", async () => {
      const hotelRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Verify Hotel Defaults", slug: "verify-hotel-defaults", industry: "HOTEL" });
      expect(hotelRes.body.enabledModules).toContain("VISITORS");
      expect(hotelRes.body.enabledModules).not.toContain("MAINTENANCE");

      const inventoryRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Verify Inventory Defaults", slug: "verify-inventory-defaults", industry: "INVENTORY" });
      expect(inventoryRes.body.enabledModules).toContain("MAINTENANCE");
      expect(inventoryRes.body.enabledModules).not.toContain("VISITORS");

      const businessRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Verify Business Defaults", slug: "verify-business-defaults", industry: "BUSINESS" });
      expect(businessRes.body.enabledModules).toContain("VISITORS");
      expect(businessRes.body.enabledModules).toContain("MAINTENANCE");
    });
  });

  describe("visitors: quick-issue expiring passes", () => {
    it("registers a card with an expiry and lists it via the hasExpiry filter", async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04915170A1", cardType: "NTAG213", label: "Guest pass", expiresAt });
      expect(res.status).toBe(201);
      expect(new Date(res.body.expiresAt).toISOString()).toBe(expiresAt);

      const listRes = await request(app)
        .get("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ hasExpiry: true, pageSize: 100 });
      expect(listRes.body.data.some((c: { id: string }) => c.id === res.body.id)).toBe(true);

      const withoutExpiryRes = await request(app)
        .get("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ hasExpiry: false, pageSize: 100 });
      expect(withoutExpiryRes.body.data.some((c: { id: string }) => c.id === res.body.id)).toBe(false);
    });

    it("refuses to issue a visitor pass for a UID that's already registered to an existing card", async () => {
      const res = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        // 04915170A1 was already registered by the previous test.
        .send({ uid: "04915170A1", cardType: "NTAG213", label: "Duplicate guest pass", expiresAt: new Date().toISOString() });
      expect(res.status).toBe(409);
    });

    it("refuses to set an expiresAt on a card already assigned to a holder", async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Already Employed Person" });

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04915170F6", cardType: "NTAG213", label: "Real employee badge" });
      const cardId = cardRes.body.id;

      await request(app)
        .post(`/api/cards/${cardId}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });

      const res = await request(app)
        .patch(`/api/cards/${cardId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already assigned/i);
    });

    it("still allows extending an existing visitor pass's own duration (never assigned to a holder)", async () => {
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04915170C3", cardType: "NTAG213", label: "Extend-me guest pass", expiresAt: new Date(Date.now() + 60_000).toISOString() });
      const cardId = cardRes.body.id;

      const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .patch(`/api/cards/${cardId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ expiresAt: newExpiresAt });
      expect(res.status).toBe(200);
      expect(new Date(res.body.expiresAt).toISOString()).toBe(newExpiresAt);
    });

    it("rejects a live-encode command against a card whose own expiry has passed, without waiting for the daily cron job", async () => {
      // A Visitors pass never leaves status UNASSIGNED (it's issued without
      // a holder), so this exercises the fix for a real gap: the card's
      // expiry used to only be enforced by flipping status to EXPIRED in a
      // once-a-day cron job — far too coarse for an hours-long pass, and
      // UNASSIGNED cards weren't even in that job's scope. Enforcement now
      // happens live, directly off expiresAt, in the websocket handler.
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "Visitor Desk Encoder", type: "ACR122U" });
      const encoderId = encoderRes.body.id;
      await prisma.encoder.update({ where: { id: encoderId }, data: { status: "ONLINE" } });

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04915170D4", cardType: "NTAG213", label: "Lapsed guest pass" });
      const cardId = cardRes.body.id;
      expect(cardRes.body.status).toBe("UNASSIGNED");

      await prisma.card.update({ where: { id: cardId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

      const socket = ioClient(`http://127.0.0.1:${env.port}/dashboard`, {
        auth: { token: companyAdminToken },
        forceNew: true,
      });
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", reject);
      });
      const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
        socket.emit("encoder:command", { encoderId, cardId, command: "READ" }, resolve)
      );
      socket.close();

      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/expired/i);
    });
  });

  describe("maintenance: asset service tickets", () => {
    let itemCardId: string;

    beforeAll(async () => {
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04915170B2", cardType: "NTAG213", label: "Projector #4" });
      itemCardId = cardRes.body.id;
    });

    it("opens a ticket, defaulting to OPEN status", async () => {
      const res = await request(app)
        .post("/api/maintenance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: itemCardId, description: "Won't power on" });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("OPEN");
      expect(res.body.resolvedAt).toBeNull();
    });

    it("rejects opening a ticket for a card outside the caller's company", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Other Maintenance Co", slug: "other-maintenance-co" });
      const otherCardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ uid: "04915170C3", cardType: "NTAG213", companyId: otherCompanyRes.body.id });

      const res = await request(app)
        .post("/api/maintenance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: otherCardRes.body.id, description: "Should not be allowed" });
      expect(res.status).toBe(400);
    });

    it("moves a ticket through in-progress to resolved, setting resolvedAt", async () => {
      const openRes = await request(app)
        .post("/api/maintenance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: itemCardId, description: "Lens is cracked" });
      const ticketId = openRes.body.id;

      const inProgressRes = await request(app)
        .patch(`/api/maintenance/${ticketId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ status: "IN_PROGRESS" });
      expect(inProgressRes.body.status).toBe("IN_PROGRESS");
      expect(inProgressRes.body.resolvedAt).toBeNull();

      const resolvedRes = await request(app)
        .patch(`/api/maintenance/${ticketId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ status: "RESOLVED" });
      expect(resolvedRes.body.status).toBe("RESOLVED");
      expect(resolvedRes.body.resolvedAt).not.toBeNull();
    });

    it("lists tickets filtered by status", async () => {
      const res = await request(app)
        .get("/api/maintenance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .query({ status: "OPEN", pageSize: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: { status: string }) => t.status === "OPEN")).toBe(true);
    });
  });

  describe("dashboard stats", () => {
    it("counts active visitor passes and open maintenance tickets", async () => {
      const before = await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${companyAdminToken}`);

      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          uid: "04915170E5",
          cardType: "NTAG213",
          label: "Dashboard stats visitor",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      await request(app)
        .post("/api/maintenance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardRes.body.id, description: "Dashboard stats ticket" });

      const after = await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(after.status).toBe(200);
      expect(after.body.activeVisitorPasses).toBe(before.body.activeVisitorPasses + 1);
      expect(after.body.openMaintenanceTickets).toBe(before.body.openMaintenanceTickets + 1);
    });

    it("counts currentlyPresent as holders whose latest general-scope tap was a check-in", async () => {
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Dashboard Presence Test Holder" });
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ uid: "04915170E6", cardType: "NTAG213" });
      await request(app)
        .post(`/api/cards/${cardRes.body.id}/assign`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ holderId: holderRes.body.id });

      const before = await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${companyAdminToken}`);

      const checkInRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardRes.body.id });
      expect(checkInRes.body.type).toBe("CHECK_IN");

      const afterCheckIn = await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(afterCheckIn.body.currentlyPresent).toBe(before.body.currentlyPresent + 1);

      const checkOutRes = await request(app)
        .post("/api/attendance")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ cardId: cardRes.body.id });
      expect(checkOutRes.body.type).toBe("CHECK_OUT");

      const afterCheckOut = await request(app).get("/api/dashboard/stats").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(afterCheckOut.body.currentlyPresent).toBe(before.body.currentlyPresent);
    });
  });

  describe("user management: edit, delete, disable/reactivate", () => {
    let targetUserId: string;

    it("lets a COMPANY_ADMIN create a user without explicitly specifying companyId", async () => {
      // The client's "New user" form never sends companyId for a
      // COMPANY_ADMIN caller (the field only renders for SUPER_ADMIN) —
      // it should fall back to the caller's own company rather than
      // rejecting the request.
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "no-explicit-company@integration-test-co.example",
          password: "NoExplicitCompany123!",
          fullName: "No Explicit Company",
          role: "VIEWER",
        });
      expect(res.status).toBe(201);
      expect(res.body.companyId).toBe(companyId);
    });

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "editable-user@integration-test-co.example",
          password: "EditableUser123!",
          fullName: "Editable User",
          role: "OPERATOR",
          companyId,
        });
      targetUserId = res.body.id;
    });

    it("lets a COMPANY_ADMIN edit a user's name and role", async () => {
      const res = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ fullName: "Renamed User", role: "MANAGER" });
      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe("Renamed User");
      expect(res.body.role).toBe("MANAGER");
    });

    it("lets an admin reset another user's password", async () => {
      const res = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ password: "BrandNewPassword123!" });
      expect(res.status).toBe(200);

      const loginRes = await request(app)
        .post("/api/auth/sign-in/email")
        .send({ email: "editable-user@integration-test-co.example", password: "BrandNewPassword123!" });
      expect(loginRes.status).toBe(200);
    });

    it("prevents a COMPANY_ADMIN from escalating a user's role to SUPER_ADMIN", async () => {
      const res = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ role: "SUPER_ADMIN" });
      expect(res.status).toBe(403);

      const check = await request(app).get(`/api/users/${targetUserId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(check.body.role).not.toBe("SUPER_ADMIN");
    });

    it("lets a SUPER_ADMIN promote a user to SUPER_ADMIN", async () => {
      const res = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ role: "SUPER_ADMIN" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("SUPER_ADMIN");

      // Revert so later tests in this describe block still see a
      // company-scoped user.
      await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ role: "OPERATOR" });
    });

    it("disabling and reactivating a user toggles isActive", async () => {
      const disableRes = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ isActive: false });
      expect(disableRes.body.isActive).toBe(false);

      const reactivateRes = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ isActive: true });
      expect(reactivateRes.body.isActive).toBe(true);
    });

    it("a deactivated user can sign in but can't mint a fresh JWT, so real API access is cut off", async () => {
      const email = "deactivation-target@integration-test-co.example";
      const password = "DeactivationTarget123!";
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ email, password, fullName: "Deactivation Target", role: "OPERATOR", companyId });
      const target = await prisma.user.findUniqueOrThrow({ where: { email } });

      await request(app)
        .patch(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ isActive: false });

      const signIn = await request(app).post("/api/auth/sign-in/email").send({ email, password });
      expect(signIn.status).toBe(200); // better-auth's own sign-in doesn't know about isActive

      const tokenRes = await request(app).get("/api/auth/token").set("Authorization", `Bearer ${signIn.body.token}`);
      expect(tokenRes.status).toBe(403); // definePayload (auth/index.ts) rejects it here instead
      expect(tokenRes.body.token).toBeUndefined();
    });

    it("lets a COMPANY_ADMIN disable a different user, but not themselves", async () => {
      const res = await request(app)
        .patch(`/api/users/${targetUserId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ isActive: false });
      expect(res.status).toBe(200); // disabling someone else is fine
      expect(res.body.isActive).toBe(false);
      // Restore for later tests in this describe block.
      await request(app).patch(`/api/users/${targetUserId}`).set("Authorization", `Bearer ${companyAdminToken}`).send({ isActive: true });

      const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${companyAdminToken}`);
      const selfRes = await request(app)
        .patch(`/api/users/${me.body.id}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ isActive: false });
      expect(selfRes.status).toBe(403);
    });

    it("a COMPANY_ADMIN cannot un-suspend their own company", async () => {
      await request(app)
        .patch(`/api/companies/${companyId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ isActive: false });

      const attempt = await request(app)
        .patch(`/api/companies/${companyId}`)
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ isActive: true });
      expect(attempt.status).toBe(200); // request succeeds, but isActive is silently stripped
      expect(attempt.body.isActive).toBe(false);

      // Restore so later tests in this file (and this describe block) still
      // see an active company.
      await request(app)
        .patch(`/api/companies/${companyId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ isActive: true });
    });

    it("prevents a user from deleting their own account", async () => {
      // DELETE /users/:id is role-gated to SUPER_ADMIN/COMPANY_ADMIN, so the
      // self-delete attempt has to come from one of those roles to actually
      // reach the self-delete check rather than being blocked earlier.
      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({
          email: "self-delete-check@integration-test-co.example",
          password: "SelfDeleteCheck123!",
          fullName: "Self Delete Check",
          role: "COMPANY_ADMIN",
          companyId,
        });
      const selfToken = await loginAs("self-delete-check@integration-test-co.example", "SelfDeleteCheck123!");

      const selfDeleteRes = await request(app).delete(`/api/users/${res.body.id}`).set("Authorization", `Bearer ${selfToken}`);
      expect(selfDeleteRes.status).toBe(400);
    });

    it("lets a COMPANY_ADMIN delete another user in their company", async () => {
      const res = await request(app).delete(`/api/users/${targetUserId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(204);

      const check = await request(app).get(`/api/users/${targetUserId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(check.status).toBe(404);
    });
  });

  describe("company grouping for SUPER_ADMIN list views", () => {
    it("includes a company relation on users/cards/holders/encoders, and sorts unscoped lists by company name first", async () => {
      const otherCoRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        // Named to alphabetically sort before every other company created in
        // this suite, so it's a reliable check that unscoped SUPER_ADMIN
        // lists really are company-name-sorted (see listUsers/listCards/
        // listHolders/listEncoders), not just returning a company relation.
        .send({ name: "AAA Grouping Test Co", slug: "aaa-grouping-test-co" });
      const otherCompanyId = otherCoRes.body.id;

      const userRes = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: "grouping-user@aaa-grouping-test-co.example",
          password: "GroupingUser123!",
          fullName: "Grouping User",
          role: "COMPANY_ADMIN",
          companyId: otherCompanyId,
        });
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Grouping Encoder", type: "ACR122U", companyId: otherCompanyId });
      const holderRes = await request(app)
        .post("/api/holders")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ fullName: "Grouping Holder", companyId: otherCompanyId });
      const cardRes = await request(app)
        .post("/api/cards")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ uid: "04AAABBBCC", cardType: "NTAG213", companyId: otherCompanyId });

      const usersRes = await request(app).get("/api/users").set("Authorization", `Bearer ${superAdminToken}`);
      const groupingUser = usersRes.body.find((u: { id: string }) => u.id === userRes.body.id);
      expect(groupingUser.company?.name).toBe("AAA Grouping Test Co");
      // The first company-affiliated user in the unscoped list should belong
      // to the alphabetically-first company.
      expect(usersRes.body.find((u: { company?: { name: string } }) => u.company)?.company?.name).toBe("AAA Grouping Test Co");

      const encodersRes = await request(app).get("/api/encoders").set("Authorization", `Bearer ${superAdminToken}`);
      expect(encodersRes.body.find((e: { id: string }) => e.id === encoderRes.body.id).company?.name).toBe("AAA Grouping Test Co");
      expect(encodersRes.body[0].company?.name).toBe("AAA Grouping Test Co");

      const holdersRes = await request(app).get("/api/holders").set("Authorization", `Bearer ${superAdminToken}`);
      expect(holdersRes.body.find((h: { id: string }) => h.id === holderRes.body.id).company?.name).toBe("AAA Grouping Test Co");
      expect(holdersRes.body[0].company?.name).toBe("AAA Grouping Test Co");

      const cardsRes = await request(app)
        .get("/api/cards")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .query({ pageSize: 100 });
      const groupingCard = cardsRes.body.data.find((c: { id: string }) => c.id === cardRes.body.id);
      expect(groupingCard.company?.name).toBe("AAA Grouping Test Co");
      expect(cardsRes.body.data[0].company?.name).toBe("AAA Grouping Test Co");
    });

    it("scoping to one company via ?companyId= still returns only that company's cards", async () => {
      const res = await request(app)
        .get("/api/cards")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .query({ companyId, pageSize: 100 });
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((c: { companyId: string }) => c.companyId === companyId)).toBe(true);
    });
  });

  describe("encoder agent key: view without rotating", () => {
    let keyEncoderId: string;
    let originalAgentKey: string;

    beforeAll(async () => {
      const encoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${companyAdminToken}`)
        .send({ name: "View Key Test Encoder", type: "ACR122U" });
      keyEncoderId = encoderRes.body.id;
      originalAgentKey = encoderRes.body.agentKey;
    });

    it("never includes the agentKey on list/get responses", async () => {
      const listRes = await request(app).get("/api/encoders").set("Authorization", `Bearer ${companyAdminToken}`);
      expect(listRes.body.find((e: { id: string }) => e.id === keyEncoderId).agentKey).toBeUndefined();

      const getRes = await request(app).get(`/api/encoders/${keyEncoderId}`).set("Authorization", `Bearer ${companyAdminToken}`);
      expect(getRes.body.agentKey).toBeUndefined();
    });

    it("lets a company admin view the current agent key without changing it", async () => {
      const res = await request(app)
        .get(`/api/encoders/${keyEncoderId}/key`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.agentKey).toBe(originalAgentKey);

      // Viewing again returns the exact same key — it's a read, not a rotation.
      const res2 = await request(app)
        .get(`/api/encoders/${keyEncoderId}/key`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res2.body.agentKey).toBe(originalAgentKey);
    });

    it("rotating the key changes it, and the old key is no longer viewable as current", async () => {
      const rotateRes = await request(app)
        .post(`/api/encoders/${keyEncoderId}/rotate-key`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.agentKey).not.toBe(originalAgentKey);

      const viewRes = await request(app)
        .get(`/api/encoders/${keyEncoderId}/key`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(viewRes.body.agentKey).toBe(rotateRes.body.agentKey);
      expect(viewRes.body.agentKey).not.toBe(originalAgentKey);
    });

    it("rejects an OPERATOR (below COMPANY_ADMIN) from viewing the agent key", async () => {
      const operatorToken = await loginAs("operator@integration-test-co.example", "Operator123!");
      const res = await request(app)
        .get(`/api/encoders/${keyEncoderId}/key`)
        .set("Authorization", `Bearer ${operatorToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects viewing another company's encoder key", async () => {
      const otherCompanyRes = await request(app)
        .post("/api/companies")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "View Key Test Other Co", slug: "view-key-test-other-co" });
      const otherEncoderRes = await request(app)
        .post("/api/encoders")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Other Co Encoder", type: "ACR122U", companyId: otherCompanyRes.body.id });

      const res = await request(app)
        .get(`/api/encoders/${otherEncoderRes.body.id}/key`)
        .set("Authorization", `Bearer ${companyAdminToken}`);
      expect(res.status).toBe(403);
    });
  });
});
