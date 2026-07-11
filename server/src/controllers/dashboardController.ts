import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { scopedCompanyId } from "../middleware/rbac";

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const cardWhere = companyId ? { companyId } : {};
  const encoderWhere = companyId ? { companyId } : {};

  const [
    totalCards,
    cardsByStatus,
    cardsByType,
    totalEncoders,
    encodersByStatus,
    totalHolders,
    totalCompanies,
    recentLogs,
  ] = await Promise.all([
    prisma.card.count({ where: cardWhere }),
    prisma.card.groupBy({ by: ["status"], where: cardWhere, _count: true }),
    prisma.card.groupBy({ by: ["cardType"], where: cardWhere, _count: true }),
    prisma.encoder.count({ where: encoderWhere }),
    prisma.encoder.groupBy({ by: ["status"], where: encoderWhere, _count: true }),
    prisma.cardHolder.count({ where: companyId ? { companyId } : {} }),
    companyId ? Promise.resolve(1) : prisma.company.count(),
    prisma.operationLog.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { performedAt: "desc" },
      take: 10,
      include: {
        card: { select: { id: true, uid: true, label: true } },
        encoder: { select: { id: true, name: true } },
        user: { select: { id: true, fullName: true } },
      },
    }),
  ]);

  res.json({
    totalCards,
    cardsByStatus: Object.fromEntries(cardsByStatus.map((c) => [c.status, c._count])),
    cardsByType: Object.fromEntries(cardsByType.map((c) => [c.cardType, c._count])),
    totalEncoders,
    encodersByStatus: Object.fromEntries(encodersByStatus.map((e) => [e.status, e._count])),
    totalHolders,
    totalCompanies,
    recentActivity: recentLogs,
  });
});
