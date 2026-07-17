import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { scopedCompanyId } from "../middleware/rbac.js";
import { NON_TERMINAL_CARD_STATUSES } from "../utils/cardStatus.js";

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
    activeVisitorPasses,
    openMaintenanceTickets,
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
    // A pass is "active" while it's not expired and hasn't been blocked/
    // lost/retired — mirrors the same NON_TERMINAL_CARD_STATUSES set the
    // expiring-cards cron job uses to decide what's still "in use".
    prisma.card.count({
      where: { ...cardWhere, expiresAt: { gt: new Date() }, status: { in: NON_TERMINAL_CARD_STATUSES } },
    }),
    prisma.maintenanceRecord.count({ where: { ...cardWhere, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
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
    activeVisitorPasses,
    openMaintenanceTickets,
  });
});
