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
  });
});
