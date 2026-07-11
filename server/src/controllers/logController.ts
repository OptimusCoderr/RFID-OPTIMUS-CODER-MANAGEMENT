import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { scopedCompanyId } from "../middleware/rbac";

export const listLogs = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 25), 100);
  const { operationType, status, cardId, encoderId, userId } = req.query as Record<string, string | undefined>;

  const where: Prisma.OperationLogWhereInput = {
    ...(companyId ? { companyId } : {}),
    ...(operationType ? { operationType: operationType as any } : {}),
    ...(status ? { status: status as any } : {}),
    ...(cardId ? { cardId } : {}),
    ...(encoderId ? { encoderId } : {}),
    ...(userId ? { userId } : {}),
  };

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
