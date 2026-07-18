import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";

export const listHolders = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const holders = await prisma.cardHolder.findMany({
    where: companyId ? { companyId } : {},
    include: { company: { select: { id: true, name: true } }, _count: { select: { cards: true } } },
    // A SUPER_ADMIN browsing across every company (companyId === null, i.e.
    // no ?companyId= filter) gets holders pre-sorted by company so the
    // client can render one section per company instead of a mixed list.
    orderBy: companyId ? { fullName: "asc" } : [{ company: { name: "asc" } }, { fullName: "asc" }],
  });
  res.json(holders);
});

export const getHolder = asyncHandler(async (req: Request, res: Response) => {
  const holder = await prisma.cardHolder.findUnique({
    where: { id: req.params.id },
    include: { cards: true },
  });
  if (!holder) throw ApiError.notFound("Card holder not found");
  assertCompanyAccess(req, holder.companyId);
  res.json(holder);
});

export const createHolder = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");
  const holder = await prisma.cardHolder.create({ data: { ...req.body, companyId } });
  res.status(201).json(holder);
});

export const updateHolder = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.cardHolder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card holder not found");
  assertCompanyAccess(req, existing.companyId);
  const { companyId: _ignored, ...data } = req.body;
  const holder = await prisma.cardHolder.update({ where: { id: req.params.id }, data });
  res.json(holder);
});

export const deleteHolder = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.cardHolder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Card holder not found");
  assertCompanyAccess(req, existing.companyId);
  await prisma.cardHolder.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
