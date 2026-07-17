import { Request, Response } from "express";
import { Prisma, MaintenanceStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import { logOperation } from "../services/operationLogService.js";

const MAINTENANCE_INCLUDE = {
  card: { select: { id: true, uid: true, label: true } },
} as const;

function buildMaintenanceWhere(req: Request): Prisma.MaintenanceRecordWhereInput {
  const companyId = scopedCompanyId(req);
  const { cardId, status } = req.query as unknown as { cardId?: string; status?: MaintenanceStatus };

  return {
    ...(companyId ? { companyId } : {}),
    ...(cardId ? { cardId } : {}),
    ...(status ? { status } : {}),
  };
}

export const listMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const where = buildMaintenanceWhere(req);

  const [total, records] = await Promise.all([
    prisma.maintenanceRecord.count({ where }),
    prisma.maintenanceRecord.findMany({
      where,
      include: MAINTENANCE_INCLUDE,
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ data: records, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

export const openMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const card = await prisma.card.findUnique({ where: { id: req.body.cardId } });
  if (!card || card.companyId !== companyId) {
    throw ApiError.badRequest("Card does not belong to this company");
  }

  const record = await prisma.maintenanceRecord.create({
    data: {
      companyId,
      cardId: card.id,
      description: req.body.description,
      notes: req.body.notes,
    },
    include: MAINTENANCE_INCLUDE,
  });

  await logOperation({
    companyId,
    cardId: card.id,
    userId: req.user!.id,
    operationType: "CREATE",
    status: "SUCCESS",
    details: { action: "open_maintenance", description: req.body.description },
  });

  res.status(201).json(record);
});

export const updateMaintenance = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.maintenanceRecord.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Maintenance record not found");
  assertCompanyAccess(req, existing.companyId);

  const status = req.body.status as MaintenanceStatus | undefined;
  const record = await prisma.maintenanceRecord.update({
    where: { id: req.params.id },
    data: {
      status,
      notes: req.body.notes,
      resolvedAt: status === "RESOLVED" ? new Date() : status ? null : undefined,
    },
    include: MAINTENANCE_INCLUDE,
  });

  await logOperation({
    companyId: existing.companyId,
    cardId: existing.cardId,
    userId: req.user!.id,
    operationType: "UPDATE",
    status: "SUCCESS",
    details: { action: "update_maintenance", status },
  });

  res.json(record);
});
