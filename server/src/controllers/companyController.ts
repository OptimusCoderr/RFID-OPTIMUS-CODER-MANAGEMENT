import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/ApiError";
import { assertCompanyAccess } from "../middleware/rbac";

export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  // Non-super-admins only ever see their own company.
  const where = req.user!.role === "SUPER_ADMIN" ? {} : { id: req.user!.companyId! };
  const companies = await prisma.company.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      _count: { select: { users: true, cards: true, encoders: true, holders: true } },
    },
  });
  res.json(companies);
});

export const getCompany = asyncHandler(async (req: Request, res: Response) => {
  assertCompanyAccess(req, req.params.id);
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: {
      _count: { select: { users: true, cards: true, encoders: true, holders: true } },
    },
  });
  if (!company) throw ApiError.notFound("Company not found");
  res.json(company);
});

export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const company = await prisma.company.create({ data: req.body });
  res.status(201).json(company);
});

export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  assertCompanyAccess(req, req.params.id);
  const company = await prisma.company.update({ where: { id: req.params.id }, data: req.body });
  res.json(company);
});

export const deleteCompany = asyncHandler(async (req: Request, res: Response) => {
  await prisma.company.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
