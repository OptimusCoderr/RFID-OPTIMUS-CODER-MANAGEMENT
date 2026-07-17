import { Request, Response } from "express";
import { CompanyIndustry, CompanyModule } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess } from "../middleware/rbac.js";
import { INDUSTRY_DEFAULT_MODULES } from "../config/industryModules.js";

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
  const body = req.body as { name: string; slug: string; industry?: CompanyIndustry; enabledModules?: CompanyModule[] };
  const company = await prisma.company.create({
    data: {
      ...body,
      // An explicit enabledModules list always wins; otherwise fall back to
      // the picked industry's defaults, or stay unrestricted (empty) if
      // neither was given.
      enabledModules: body.enabledModules ?? (body.industry ? INDUSTRY_DEFAULT_MODULES[body.industry] : []),
    },
  });
  res.status(201).json(company);
});

export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  assertCompanyAccess(req, req.params.id);

  // Which modules a company has access to is a platform-level decision —
  // a COMPANY_ADMIN can update their own company's contact details, but
  // not grant themselves additional modules.
  const data = { ...req.body } as { industry?: CompanyIndustry | null; enabledModules?: CompanyModule[] } & Record<string, unknown>;
  if (req.user!.role !== "SUPER_ADMIN") {
    delete data.industry;
    delete data.enabledModules;
  } else if (data.industry && data.enabledModules === undefined) {
    data.enabledModules = INDUSTRY_DEFAULT_MODULES[data.industry];
  }

  const company = await prisma.company.update({ where: { id: req.params.id }, data });
  res.json(company);
});

export const deleteCompany = asyncHandler(async (req: Request, res: Response) => {
  await prisma.company.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
