import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { scopedCompanyId } from "../middleware/rbac";
import { toCsv } from "../utils/csv";

function buildLogWhere(req: Request): Prisma.OperationLogWhereInput {
  const companyId = scopedCompanyId(req);
  const { operationType, status, cardId, encoderId, userId } = req.query as Record<string, string | undefined>;

  return {
    ...(companyId ? { companyId } : {}),
    ...(operationType ? { operationType: operationType as any } : {}),
    ...(status ? { status: status as any } : {}),
    ...(cardId ? { cardId } : {}),
    ...(encoderId ? { encoderId } : {}),
    ...(userId ? { userId } : {}),
  };
}

export const listLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 25), 100);
  const where = buildLogWhere(req);

  const [total, logs] = await Promise.all([
    prisma.operationLog.count({ where }),
    prisma.operationLog.findMany({
      where,
      orderBy: { performedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        card: { select: { id: true, uid: true, label: true } },
        encoder: { select: { id: true, name: true } },
        user: { select: { id: true, fullName: true } },
        company: { select: { id: true, name: true } },
      },
    }),
  ]);

  res.json({ data: logs, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

const EXPORT_ROW_LIMIT = 10_000;

export const exportLogs = asyncHandler(async (req: Request, res: Response) => {
  const where = buildLogWhere(req);
  const logs = await prisma.operationLog.findMany({
    where,
    orderBy: { performedAt: "desc" },
    take: EXPORT_ROW_LIMIT,
    include: {
      card: { select: { id: true, uid: true, label: true } },
      encoder: { select: { id: true, name: true } },
      user: { select: { id: true, fullName: true } },
    },
  });

  const csv = toCsv(logs, [
    { key: "performedAt", header: "When", value: (l) => l.performedAt.toISOString() },
    { key: "operationType", header: "Operation", value: (l) => l.operationType },
    { key: "status", header: "Status", value: (l) => l.status },
    { key: "card", header: "Card", value: (l) => l.card?.label ?? l.card?.uid },
    { key: "encoder", header: "Encoder", value: (l) => l.encoder?.name },
    { key: "user", header: "User", value: (l) => l.user?.fullName },
    { key: "errorMessage", header: "Error", value: (l) => l.errorMessage },
  ]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});
