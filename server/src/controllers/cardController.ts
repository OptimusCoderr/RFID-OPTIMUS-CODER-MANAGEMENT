import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import {
  encryptSecret,
  decryptSecret,
  generateMifareKey,
  generateDataKey,
  encryptForCard,
  decryptForCard,
  citizenRecordCapacityBytes,
} from "../utils/crypto.js";
import { logOperation } from "../services/operationLogService.js";
import { notifyCompanyAdmins } from "../services/notificationService.js";
import { toCsv } from "../utils/csv.js";

const CARD_INCLUDE = {
  company: { select: { id: true, name: true } },
  holder: { select: { id: true, fullName: true, department: true, employeeId: true } },
  template: { select: { id: true, name: true } },
  registeredByEncoder: { select: { id: true, name: true } },
  accessZones: { include: { zone: { select: { id: true, name: true } } } },
  encoderAllocations: { include: { encoder: { select: { id: true, name: true, location: true } } } },
} satisfies Prisma.CardInclude;

function buildCardWhere(req: Request): Prisma.CardWhereInput {
  const companyId = scopedCompanyId(req);
  const { status, cardType, holderId, search, hasExpiry } = req.query as unknown as {
    status?: string;
    cardType?: string;
    holderId?: string;
    search?: string;
    hasExpiry?: boolean;
  };

  return {
    ...(companyId ? { companyId } : {}),
    ...(status ? { status: status as any } : {}),
    ...(cardType ? { cardType: cardType as any } : {}),
    ...(holderId ? { holderId } : {}),
    // Used by the Visitors page to list only auto-expiring passes, not the
    // whole company's card inventory.
    ...(hasExpiry !== undefined ? { expiresAt: hasExpiry ? { not: null } : null } : {}),
    ...(search
      ? {
          OR: [
            { uid: { contains: search, mode: "insensitive" } },
            { label: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const listCards = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const where = buildCardWhere(req);

  // A SUPER_ADMIN browsing across every company (no ?companyId= filter)
  // gets cards pre-clustered by company — sorting by company name first so
  // consecutive rows in any given page already share a company, letting the
  // client render a group header per company instead of a mixed list.
  // Scoped to one company already, that first key is a no-op.
  const orderBy: Prisma.CardOrderByWithRelationInput[] =
    scopedCompanyId(req) === null ? [{ company: { name: "asc" } }, { createdAt: "desc" }] : [{ createdAt: "desc" }];

  const [total, cards] = await Promise.all([
    prisma.card.count({ where }),
    prisma.card.findMany({
      where,
      include: CARD_INCLUDE,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    data: cards.map(({ keysEncrypted, ...rest }) => rest),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

export const getCard = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: CARD_INCLUDE });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);
  const { keysEncrypted, ...safe } = card;
  res.json({ ...safe, hasStoredKeys: Boolean(keysEncrypted) });
});

// Elevated endpoint — decrypts and returns the sector/page keys for use during an encode operation.
export const getCardKeys = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);
  if (!card.keysEncrypted) return res.json({ keys: null });
  const keys = JSON.parse(decryptSecret(card.keysEncrypted));
  res.json({ keys });
});

const MIFARE_CLASSIC_TYPES = new Set(["MIFARE_CLASSIC_1K", "MIFARE_CLASSIC_4K", "MIFARE_CLASSIC_MINI"]);

// Replaces this card's stored sector keys with freshly generated random ones —
// one Key A + Key B per sector the card's template defines (or just sector 0
// if it has none), so distinct cards don't share a guessable/default key.
// Keys are named `${sector}A` / `${sector}B` in the stored map, matching what
// the Live Encode "card data" flow looks up per block.
export const generateCardKeys = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { template: true } });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);

  if (!MIFARE_CLASSIC_TYPES.has(card.cardType)) {
    throw ApiError.badRequest("Random key generation only applies to MIFARE Classic cards");
  }

  const sectors = ((card.template?.layout as any)?.sectors as { sector: number }[] | undefined)?.map((s) => s.sector) ?? [0];

  const keys: Record<string, string> = {};
  for (const sector of new Set(sectors)) {
    keys[`${sector}A`] = generateMifareKey();
    keys[`${sector}B`] = generateMifareKey();
  }
  // Also (re)generate the card's data-encryption key — used by
  // prepareCitizenWrite/decodeCitizenRead below for any template that
  // configures an encrypted citizen record. Harmless to have even if the
  // card's template doesn't use one.
  keys.dataKey = generateDataKey();

  await prisma.card.update({ where: { id: card.id }, data: { keysEncrypted: encryptSecret(JSON.stringify(keys)) } });

  await logOperation({
    companyId: card.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "UPDATE",
    status: "SUCCESS",
    // Never log the actual key material — just which sectors were touched.
    details: { action: "generate_keys", sectors: Array.from(new Set(sectors)) },
  });

  res.json({ keys });
});

interface CitizenRecordLayout {
  fields: string[];
  blocks: { sector: number; block: number }[];
}

function getCitizenRecord(template: { layout: unknown } | null): CitizenRecordLayout {
  const record = (template?.layout as any)?.citizenRecord as CitizenRecordLayout | undefined;
  if (!record) throw ApiError.badRequest("This card's template has no encrypted citizen record configured");
  return record;
}

function getDataKey(card: { keysEncrypted: string | null }): string {
  if (!card.keysEncrypted) throw ApiError.badRequest("Generate this card's keys before writing citizen data");
  const keys = JSON.parse(decryptSecret(card.keysEncrypted)) as Record<string, string>;
  if (!keys.dataKey) throw ApiError.badRequest("This card has no data encryption key — regenerate its keys");
  return keys.dataKey;
}

// Encrypts the given field values into one AES-256-GCM blob sized to exactly
// fill the template's configured blocks, then hands back only opaque
// per-block ciphertext — the data key itself never reaches the client, only
// the sector auth keys already exposed by getCardKeys (a deliberately
// smaller trust boundary: a browser needs the auth key to *access* a block,
// but never needs the data key to *understand* what's on it).
export const prepareCitizenWrite = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { template: true } });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);

  const record = getCitizenRecord(card.template);
  const dataKey = getDataKey(card);

  const fields: Record<string, string> = {};
  for (const name of record.fields) fields[name] = String(req.body.fields?.[name] ?? "");

  const capacity = citizenRecordCapacityBytes(record.blocks.length);
  const plaintext = Buffer.from(JSON.stringify(fields), "utf8");
  if (plaintext.length > capacity) {
    throw ApiError.badRequest(
      `Citizen data is too large for this card (${plaintext.length} bytes, ${capacity} available) — shorten the values or add more blocks to the template`
    );
  }
  const padded = Buffer.concat([plaintext, Buffer.alloc(capacity - plaintext.length)]);
  const blob = encryptForCard(padded, dataKey);

  const blocks = record.blocks.map((b, i) => ({
    sector: b.sector,
    block: b.block,
    dataHex: blob.subarray(i * 16, (i + 1) * 16).toString("hex"),
  }));

  await logOperation({
    companyId: card.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "WRITE",
    status: "SUCCESS",
    details: { action: "prepare_citizen_write", fields: record.fields },
  });

  res.json({ blocks });
});

// Reverses prepareCitizenWrite: given the raw hex actually read back off the
// card's configured blocks, reassembles and decrypts the blob server-side
// and returns the plain field values.
export const decodeCitizenRead = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { template: true } });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);

  const record = getCitizenRecord(card.template);
  const dataKey = getDataKey(card);

  const provided = req.body.blocks as { block: number; dataHex: string }[];
  const byBlock = new Map(provided.map((b) => [b.block, b.dataHex]));
  const chunks: Buffer[] = [];
  for (const b of record.blocks) {
    const hex = byBlock.get(b.block);
    if (!hex) throw ApiError.badRequest(`Missing block ${b.block} in the submitted read data`);
    chunks.push(Buffer.from(hex, "hex"));
  }
  const blob = Buffer.concat(chunks);

  let padded: Buffer;
  try {
    padded = decryptForCard(blob, dataKey);
  } catch {
    throw ApiError.badRequest("Could not decrypt this card's data — it may be blank, corrupted, or written with a different key");
  }

  const nullIndex = padded.indexOf(0);
  const plaintext = (nullIndex === -1 ? padded : padded.subarray(0, nullIndex)).toString("utf8");
  let fields: Record<string, string>;
  try {
    fields = JSON.parse(plaintext);
  } catch {
    throw ApiError.badRequest("Decrypted data wasn't valid — this card may not have been written by this app");
  }

  await logOperation({
    companyId: card.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "READ",
    status: "SUCCESS",
    details: { action: "decode_citizen_read" },
  });

  res.json({ fields });
});

export const registerCard = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const { uid, cardType, label, notes, templateId, registeredByEncoderId, keys, expiresAt } = req.body;

  if (templateId) {
    const template = await prisma.cardTemplate.findUnique({ where: { id: templateId } });
    if (!template || template.companyId !== companyId) {
      throw ApiError.badRequest("Template does not belong to this company");
    }
  }

  const existing = await prisma.card.findUnique({ where: { companyId_uid: { companyId, uid } } });
  if (existing) throw ApiError.conflict("A card with this UID is already registered for this company");

  const card = await prisma.card.create({
    data: {
      companyId,
      uid,
      cardType,
      label,
      notes,
      templateId,
      registeredByEncoderId,
      status: "UNASSIGNED",
      issuedAt: new Date(),
      expiresAt,
      keysEncrypted: keys ? encryptSecret(JSON.stringify(keys)) : undefined,
    },
    include: CARD_INCLUDE,
  });

  await logOperation({
    companyId,
    cardId: card.id,
    encoderId: registeredByEncoderId,
    userId: req.user!.id,
    operationType: "REGISTER",
    status: "SUCCESS",
    details: { uid, cardType },
  });

  const { keysEncrypted, ...safe } = card;
  res.status(201).json(safe);
});

export const updateCard = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, existing.companyId);

  // A card already assigned to a holder is in use by that person — setting
  // an expiresAt on it is how this app issues/extends a visitor pass (see
  // VisitorsPage), so allowing that here would let someone's real badge get
  // silently turned into a temporary guest pass. Extending an *existing*
  // visitor pass's own duration still works fine: those cards are never
  // assigned to a holder in the first place, so existing.holderId is null
  // for them.
  if (req.body.expiresAt !== undefined && existing.holderId) {
    throw ApiError.badRequest("This card is already assigned to a card holder and can't also be issued as a visitor pass");
  }

  if (req.body.templateId) {
    const template = await prisma.cardTemplate.findUnique({ where: { id: req.body.templateId } });
    if (!template || template.companyId !== existing.companyId) {
      throw ApiError.badRequest("Template does not belong to this company");
    }
  }

  const { keys, ...rest } = req.body;
  const data: Prisma.CardUpdateInput = { ...rest };
  if (keys) data.keysEncrypted = encryptSecret(JSON.stringify(keys));

  const card = await prisma.card.update({ where: { id: req.params.id }, data, include: CARD_INCLUDE });

  await logOperation({
    companyId: existing.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "UPDATE",
    status: "SUCCESS",
    details: { fields: Object.keys(rest) },
  });

  // The dedicated /block and /lost endpoints notify company admins when they
  // change a card's status — this generic PATCH can set the same status
  // field directly (kept as an escape hatch for fixing a status that's out
  // of sync, see the client's edit form), so it needs to raise the same
  // notification when it's used that way, or admins silently miss a card
  // going BLOCKED/LOST through this path.
  if (rest.status === "BLOCKED" || rest.status === "LOST") {
    await notifyCompanyAdmins(existing.companyId, {
      type: rest.status === "LOST" ? "CARD_LOST" : "CARD_BLOCKED",
      title: rest.status === "LOST" ? "Card reported lost" : "Card blocked",
      message: `${card.label ?? card.uid} was marked ${rest.status.toLowerCase()}.`,
      link: `/cards/${card.id}`,
    }).catch(() => undefined);
  }

  const { keysEncrypted, ...safe } = card;
  res.json(safe);
});

// Assign/unassign are OPERATOR_UP (cardRoutes.ts) while block/unblock/lost/
// retire are MANAGER_UP-only (setStatus below) — without this check, an
// OPERATOR could silently reactivate a blocked/lost/retired card just by
// assigning or unassigning it, skipping the stricter role gate entirely and
// leaving no BLOCK/UNBLOCK audit entry or admin notification behind.
const LIFECYCLE_LOCKED_STATUSES = new Set(["BLOCKED", "LOST", "RETIRED", "EXPIRED"]);

export const assignCard = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, existing.companyId);
  if (LIFECYCLE_LOCKED_STATUSES.has(existing.status)) {
    throw ApiError.badRequest(`This card is ${existing.status.toLowerCase()} and must be unblocked before it can be assigned`);
  }

  const holder = await prisma.cardHolder.findUnique({ where: { id: req.body.holderId } });
  if (!holder || holder.companyId !== existing.companyId) {
    throw ApiError.badRequest("Card holder does not belong to this company");
  }

  const card = await prisma.card.update({
    where: { id: req.params.id },
    data: { holderId: holder.id, status: "ASSIGNED" },
    include: CARD_INCLUDE,
  });

  await logOperation({
    companyId: existing.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "ASSIGN",
    status: "SUCCESS",
    details: { holderId: holder.id },
  });

  const { keysEncrypted, ...safe } = card;
  res.json(safe);
});

export const unassignCard = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, existing.companyId);
  if (LIFECYCLE_LOCKED_STATUSES.has(existing.status)) {
    throw ApiError.badRequest(`This card is ${existing.status.toLowerCase()} and must be unblocked before it can be unassigned`);
  }

  const card = await prisma.card.update({
    where: { id: req.params.id },
    data: { holderId: null, status: "UNASSIGNED" },
    include: CARD_INCLUDE,
  });

  await logOperation({
    companyId: existing.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "UNASSIGN",
    status: "SUCCESS",
  });

  const { keysEncrypted, ...safe } = card;
  res.json(safe);
});

async function setStatus(req: Request, res: Response, status: "BLOCKED" | "ACTIVE" | "LOST" | "RETIRED", opType: "BLOCK" | "UNBLOCK") {
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, existing.companyId);

  const card = await prisma.card.update({ where: { id: req.params.id }, data: { status }, include: CARD_INCLUDE });

  await logOperation({
    companyId: existing.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: opType,
    status: "SUCCESS",
  });

  if (status === "BLOCKED" || status === "LOST") {
    // Awaited so the notification is guaranteed to exist by the time this
    // request resolves (callers reasonably check /notifications right after);
    // still caught so a notification failure never fails the card update.
    await notifyCompanyAdmins(existing.companyId, {
      type: status === "LOST" ? "CARD_LOST" : "CARD_BLOCKED",
      title: status === "LOST" ? "Card reported lost" : "Card blocked",
      message: `${card.label ?? card.uid} was marked ${status.toLowerCase()}.`,
      link: `/cards/${card.id}`,
    }).catch(() => undefined);
  }

  const { keysEncrypted, ...safe } = card;
  res.json(safe);
}

export const blockCard = asyncHandler((req, res) => setStatus(req, res, "BLOCKED", "BLOCK"));
export const unblockCard = asyncHandler((req, res) => setStatus(req, res, "ACTIVE", "UNBLOCK"));
export const markLostCard = asyncHandler((req, res) => setStatus(req, res, "LOST", "BLOCK"));
export const retireCard = asyncHandler((req, res) => setStatus(req, res, "RETIRED", "BLOCK"));

export const deleteCard = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, existing.companyId);
  await prisma.card.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

const EXPORT_ROW_LIMIT = 10_000;

export const exportCards = asyncHandler(async (req: Request, res: Response) => {
  const where = buildCardWhere(req);
  const cards = await prisma.card.findMany({
    where,
    include: CARD_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT,
  });

  const csv = toCsv(cards, [
    { key: "uid", header: "UID", value: (c) => c.uid },
    { key: "cardType", header: "Card Type", value: (c) => c.cardType },
    { key: "status", header: "Status", value: (c) => c.status },
    { key: "label", header: "Label", value: (c) => c.label },
    { key: "holder", header: "Holder", value: (c) => c.holder?.fullName },
    { key: "template", header: "Template", value: (c) => c.template?.name },
    { key: "issuedAt", header: "Issued At", value: (c) => c.issuedAt?.toISOString() },
    { key: "expiresAt", header: "Expires At", value: (c) => c.expiresAt?.toISOString() },
    { key: "createdAt", header: "Created At", value: (c) => c.createdAt.toISOString() },
  ]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cards-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

interface BulkImportRow {
  uid: string;
  cardType: string;
  label?: string;
  templateId?: string;
}

export const bulkImportCards = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  // Non-empty and <=500 rows are already enforced by bulkImportCardsBody
  // (validators/card.ts) before this handler runs.
  const rows = req.body.rows as BulkImportRow[];

  const errors: { row: number; uid?: string; error: string }[] = [];
  const candidates: { row: number; uid: string; cardType: string; label?: string; templateId?: string }[] = [];
  const seenUids = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const uid = row.uid?.trim().toUpperCase();
    if (!uid || !/^[0-9A-F]{8,20}$/.test(uid)) {
      errors.push({ row: i + 1, uid: row.uid, error: "Invalid or missing UID (expected 8-20 hex characters)" });
      continue;
    }
    if (!row.cardType) {
      errors.push({ row: i + 1, uid, error: "Missing cardType" });
      continue;
    }
    if (seenUids.has(uid)) {
      errors.push({ row: i + 1, uid, error: "Duplicate UID within this import" });
      continue;
    }
    seenUids.add(uid);
    candidates.push({ row: i + 1, uid, cardType: row.cardType, label: row.label, templateId: row.templateId });
  }

  let created = 0;
  let skipped = 0;

  // Batched instead of one query per row — a full 500-row import used to
  // mean up to ~1500 sequential round-trips (existence check + create + log
  // per row); this brings it down to a handful of queries total.
  if (candidates.length > 0) {
    const existing = await prisma.card.findMany({
      where: { companyId, uid: { in: candidates.map((c) => c.uid) } },
      select: { uid: true },
    });
    const existingUids = new Set(existing.map((c) => c.uid));

    // A templateId that doesn't belong to this company is dropped rather
    // than failing the row — the card still gets created, just without a
    // template, instead of a stray cross-tenant reference silently leaking
    // another company's template name onto this card later.
    const requestedTemplateIds = [...new Set(candidates.map((c) => c.templateId).filter((id): id is string => Boolean(id)))];
    const validTemplates =
      requestedTemplateIds.length > 0
        ? await prisma.cardTemplate.findMany({ where: { id: { in: requestedTemplateIds }, companyId }, select: { id: true } })
        : [];
    const validTemplateIds = new Set(validTemplates.map((t) => t.id));

    const toCreate = candidates.filter((c) => !existingUids.has(c.uid));
    skipped = candidates.length - toCreate.length;

    if (toCreate.length > 0) {
      const createdCards = await prisma.card.createManyAndReturn({
        data: toCreate.map((c) => ({
          companyId,
          uid: c.uid,
          cardType: c.cardType as any,
          label: c.label || undefined,
          templateId: c.templateId && validTemplateIds.has(c.templateId) ? c.templateId : undefined,
          status: "UNASSIGNED",
          issuedAt: new Date(),
        })),
      });
      created = createdCards.length;

      await prisma.operationLog.createMany({
        data: createdCards.map((card) => ({
          companyId,
          cardId: card.id,
          userId: req.user!.id,
          operationType: "REGISTER" as const,
          status: "SUCCESS" as const,
          details: { uid: card.uid, cardType: card.cardType, source: "bulk_import" },
        })),
      });
    }
  }

  res.json({ created, skipped, errors });
});

// Restricting a card to specific encoder(s) is opt-in: a card with no
// allocation rows is usable with any encoder in the company. Granting the
// first allocation is what turns restriction on for that card.
export const grantCardEncoders = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);

  const encoders = await prisma.encoder.findMany({
    where: { id: { in: req.body.encoderIds }, companyId: card.companyId },
  });
  if (encoders.length !== req.body.encoderIds.length) {
    throw ApiError.badRequest("One or more encoders do not belong to this company");
  }

  const expiresAt = req.body.expiresAt ?? null;

  await prisma.$transaction(
    encoders.map((encoder) =>
      prisma.cardEncoderAllocation.upsert({
        where: { cardId_encoderId: { cardId: card.id, encoderId: encoder.id } },
        // Re-granting an existing allocation updates its expiry (e.g.
        // extending a hotel guest's stay) rather than being a no-op.
        update: { expiresAt },
        create: { cardId: card.id, encoderId: encoder.id, expiresAt },
      })
    )
  );

  await logOperation({
    companyId: card.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "UPDATE",
    status: "SUCCESS",
    details: { action: "grant_encoder_allocation", encoderIds: req.body.encoderIds, expiresAt },
  });

  res.status(204).send();
});

export const revokeCardEncoders = asyncHandler(async (req: Request, res: Response) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!card) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, card.companyId);

  await prisma.cardEncoderAllocation.deleteMany({
    where: { cardId: card.id, encoderId: { in: req.body.encoderIds } },
  });

  await logOperation({
    companyId: card.companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "UPDATE",
    status: "SUCCESS",
    details: { action: "revoke_encoder_allocation", encoderIds: req.body.encoderIds },
  });

  res.status(204).send();
});
