import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";

export const listZones = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const zones = await prisma.accessZone.findMany({
    where: companyId ? { companyId } : {},
    include: { _count: { select: { cards: true } } },
    orderBy: { name: "asc" },
  });
  res.json(zones);
});

export const createZone = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");
  const zone = await prisma.accessZone.create({ data: { ...req.body, companyId } });
  res.status(201).json(zone);
});

export const updateZone = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.accessZone.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Access zone not found");
  assertCompanyAccess(req, existing.companyId);
  const { companyId: _ignored, ...data } = req.body;
  const zone = await prisma.accessZone.update({ where: { id: req.params.id }, data });
  res.json(zone);
});

export const deleteZone = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.accessZone.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Access zone not found");
  assertCompanyAccess(req, existing.companyId);
  await prisma.accessZone.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export const grantZoneAccess = asyncHandler(async (req: Request, res: Response) => {
  const zone = await prisma.accessZone.findUnique({ where: { id: req.params.id } });
  if (!zone) throw ApiError.notFound("Access zone not found");
  assertCompanyAccess(req, zone.companyId);

  const cards = await prisma.card.findMany({ where: { id: { in: req.body.cardIds }, companyId: zone.companyId } });
  if (cards.length !== req.body.cardIds.length) {
    throw ApiError.badRequest("One or more cards do not belong to this company");
  }

  await prisma.$transaction(
    cards.map((card) =>
      prisma.cardAccessZone.upsert({
        where: { cardId_zoneId: { cardId: card.id, zoneId: zone.id } },
        update: {},
        create: { cardId: card.id, zoneId: zone.id },
      })
    )
  );

  res.status(204).send();
});

export const revokeZoneAccess = asyncHandler(async (req: Request, res: Response) => {
  const zone = await prisma.accessZone.findUnique({ where: { id: req.params.id } });
  if (!zone) throw ApiError.notFound("Access zone not found");
  assertCompanyAccess(req, zone.companyId);

  await prisma.cardAccessZone.deleteMany({ where: { zoneId: zone.id, cardId: { in: req.body.cardIds } } });
  res.status(204).send();
});
