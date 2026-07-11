import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/ApiError";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac";
import { encryptSecret, decryptSecret } from "../utils/crypto";
import { logOperation } from "../services/operationLogService";
import { notifyCompanyAdmins } from "../services/notificationService";
import { toCsv } from "../utils/csv";

const CARD_INCLUDE = {
  holder: { select: { id: true, fullName: true, department: true, employeeId: true } },
  template: { select: { id: true, name: true } },
  registeredByEncoder: { select: { id: true, name: true } },
  accessZones: { include: { zone: { select: { id: true, name: true } } } },
} satisfies Prisma.CardInclude;

function buildCardWhere(req: Request): Prisma.CardWhereInput {
  const companyId = scopedCompanyId(req);
  const { status, cardType, holderId, search } = req.query as unknown as {
    status?: string;
    cardType?: string;
    holderId?: string;
    search?: string;
  };

  return {
    ...(companyId ? { companyId } : {}),
    ...(status ? { status: status as any } : {}),
    ...(cardType ? { cardType: cardType as any } : {}),
    ...(holderId ? { holderId } : {}),
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

  const [total, cards] = await Promise.all([
    prisma.card.count({ where }),
    prisma.card.findMany({
      where,
      include: CARD_INCLUDE,
      orderBy: { createdAt: "desc" },
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

export const registerCard = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const { uid, cardType, label, notes, templateId, registeredByEncoderId, keys } = req.body;

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

  const { keysEncrypted, ...safe } = card;
  res.json(safe);
});

export const assignCard = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card not found");
  assertCompanyAccess(req, existing.companyId);

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
    notifyCompanyAdmins(existing.companyId, {
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

const MAX_BULK_IMPORT_ROWS = 500;

export const bulkImportCards = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const rows = req.body.rows as BulkImportRow[];
  if (!Array.isArray(rows) || rows.length === 0) throw ApiError.badRequest("rows must be a non-empty array");
  if (rows.length > MAX_BULK_IMPORT_ROWS) throw ApiError.badRequest(`A single import is limited to ${MAX_BULK_IMPORT_ROWS} rows`);

  let created = 0;
  let skipped = 0;
  const errors: { row: number; uid?: string; error: string }[] = [];

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

    try {
      const existing = await prisma.card.findUnique({ where: { companyId_uid: { companyId, uid } } });
      if (existing) {
        skipped += 1;
        continue;
      }
      const card = await prisma.card.create({
        data: {
          companyId,
          uid,
          cardType: row.cardType as any,
          label: row.label || undefined,
          templateId: row.templateId || undefined,
          status: "UNASSIGNED",
          issuedAt: new Date(),
        },
      });
      await logOperation({
        companyId,
        cardId: card.id,
        userId: req.user!.id,
        operationType: "REGISTER",
        status: "SUCCESS",
        details: { uid, cardType: row.cardType, source: "bulk_import" },
      });
      created += 1;
    } catch (err) {
      errors.push({ row: i + 1, uid, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  res.json({ created, skipped, errors });
});
