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

  describe("card data deletion: clear-write role gate + audit logging", () => {
    let clearEncoderId: string;
    let clearCardId: string;
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
});
