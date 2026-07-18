import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { auth } from "../src/auth/index.js";

const prisma = new PrismaClient();

// signUpEmail (unlike prisma.user.upsert) throws on a duplicate email, so
// this re-runs safely across repeated `npm run prisma:seed` invocations by
// checking first — the seeded accounts' passwords are only ever set on
// first creation, matching the old upsert's update:{} (no-op on repeat).
async function ensureUser(input: { email: string; password: string; fullName: string; role: string; companyId?: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return existing;

  // role/companyId aren't passed here — better-auth's additionalFields
  // config marks both input: false (see src/auth/index.ts), so they're set
  // via a follow-up update instead. See userController.createUser for the
  // same pattern.
  await auth.api.signUpEmail({
    body: { name: input.fullName, email: input.email, password: input.password },
  });
  await prisma.user.update({ where: { email: input.email }, data: { role: input.role, companyId: input.companyId } });
  return prisma.user.findUniqueOrThrow({ where: { email: input.email } });
}

async function main() {
  const superAdminEmail = process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@rfidmanager.local";
  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe123!";

  const superAdmin = await ensureUser({
    email: superAdminEmail,
    password: superAdminPassword,
    fullName: "Platform Super Admin",
    role: "SUPER_ADMIN",
  });
  console.log(`Super admin ready: ${superAdmin.email}`);

  const company = await prisma.company.upsert({
    where: { slug: "acme-logistics" },
    update: {},
    create: {
      name: "Acme Logistics",
      slug: "acme-logistics",
      contactEmail: "ops@acme-logistics.example",
      address: "1 Warehouse Way, Springfield",
    },
  });

  const companyAdminEmail = "admin@acme-logistics.example";
  const companyAdmin = await ensureUser({
    email: companyAdminEmail,
    password: "ChangeMe123!",
    fullName: "Acme Company Admin",
    role: "COMPANY_ADMIN",
    companyId: company.id,
  });
  console.log(`Company admin ready: ${companyAdmin.email}`);

  const operator = await ensureUser({
    email: "operator@acme-logistics.example",
    password: "ChangeMe123!",
    fullName: "Front Desk Operator",
    role: "OPERATOR",
    companyId: company.id,
  });
  console.log(`Operator ready: ${operator.email}`);

  const [alice, _bob] = await Promise.all([
    prisma.cardHolder.create({
      data: { companyId: company.id, fullName: "Alice Nwosu", department: "Warehouse", employeeId: "EMP-001" },
    }),
    prisma.cardHolder.create({
      data: { companyId: company.id, fullName: "Bob Chen", department: "Security", employeeId: "EMP-002" },
    }),
  ]);

  const mifareTemplate = await prisma.cardTemplate.create({
    data: {
      companyId: company.id,
      name: "Standard Employee Badge (MIFARE Classic 1K)",
      cardType: "MIFARE_CLASSIC_1K",
      isDefault: true,
      description: "Sector 1 stores employee ID + access level; default factory keys elsewhere.",
      layout: {
        sectors: [
          { sector: 0, keyA: "FFFFFFFFFFFF", blocks: [{ block: 0, purpose: "Manufacturer data (read-only)" }] },
          {
            sector: 1,
            keyA: "FFFFFFFFFFFF",
            blocks: [
              { block: 4, purpose: "Employee ID" },
              { block: 5, purpose: "Access level" },
            ],
          },
        ],
        notes: "Rotate Key A away from factory default before production rollout.",
      },
    },
  });

  const ntagTemplate = await prisma.cardTemplate.create({
    data: {
      companyId: company.id,
      name: "Visitor Tag (NTAG213)",
      cardType: "NTAG213",
      isDefault: true,
      description: "NDEF URI record pointing to the visitor check-in page.",
      layout: {
        pages: [
          { startPage: 4, endPage: 6, purpose: "NDEF message" },
          { startPage: 7, endPage: 39, purpose: "User memory" },
        ],
        ndef: true,
      },
    },
  });

  const encoder = await prisma.encoder.create({
    data: {
      companyId: company.id,
      name: "Front Desk ACR122U",
      type: "ACR122U",
      connectionType: "USB",
      location: "Reception",
      agentKey: crypto.randomBytes(24).toString("hex"),
      status: "OFFLINE",
    },
  });

  const zone = await prisma.accessZone.create({
    data: { companyId: company.id, name: "Main Warehouse Floor", description: "Ground floor roller doors" },
  });

  const card1 = await prisma.card.create({
    data: {
      companyId: company.id,
      uid: "04A1B2C3D4",
      cardType: "MIFARE_CLASSIC_1K",
      status: "ASSIGNED",
      label: "Badge #001",
      templateId: mifareTemplate.id,
      holderId: alice.id,
      registeredByEncoderId: encoder.id,
      issuedAt: new Date(),
    },
  });

  await prisma.card.create({
    data: {
      companyId: company.id,
      uid: "04E5F6A7B8",
      cardType: "NTAG213",
      status: "UNASSIGNED",
      label: "Visitor Tag #014",
      templateId: ntagTemplate.id,
      registeredByEncoderId: encoder.id,
      issuedAt: new Date(),
    },
  });

  await prisma.cardAccessZone.create({ data: { cardId: card1.id, zoneId: zone.id } });

  await prisma.operationLog.create({
    data: {
      companyId: company.id,
      cardId: card1.id,
      encoderId: encoder.id,
      userId: operator.id,
      operationType: "REGISTER",
      status: "SUCCESS",
      details: { seed: true },
    },
  });

  console.log("Seed complete.");
  console.log("---");
  console.log(`Super admin login: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`Company admin login: ${companyAdminEmail} / ChangeMe123!`);
  console.log(`Operator login: operator@acme-logistics.example / ChangeMe123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
