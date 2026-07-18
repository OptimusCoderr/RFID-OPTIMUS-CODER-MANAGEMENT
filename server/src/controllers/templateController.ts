import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import { withSerializableRetry } from "../utils/serializableRetry.js";

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const templates = await prisma.cardTemplate.findMany({
    where: companyId ? { companyId } : {},
    orderBy: { name: "asc" },
  });
  res.json(templates);
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await prisma.cardTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) throw ApiError.notFound("Template not found");
  assertCompanyAccess(req, template.companyId);
  res.json(template);
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const template = req.body.isDefault
    ? await withSerializableRetry(() =>
        prisma.$transaction(
          async (tx) => {
            await tx.cardTemplate.updateMany({
              where: { companyId, cardType: req.body.cardType, isDefault: true },
              data: { isDefault: false },
            });
            return tx.cardTemplate.create({ data: { ...req.body, companyId } });
          },
          { isolationLevel: "Serializable" }
        )
      )
    : await prisma.cardTemplate.create({ data: { ...req.body, companyId } });
  res.status(201).json(template);
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.cardTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Template not found");
  assertCompanyAccess(req, existing.companyId);

  const { companyId: _ignored, ...data } = req.body;
  const template = req.body.isDefault
    ? await withSerializableRetry(() =>
        prisma.$transaction(
          async (tx) => {
            await tx.cardTemplate.updateMany({
              where: {
                companyId: existing.companyId,
                cardType: req.body.cardType ?? existing.cardType,
                id: { not: existing.id },
                isDefault: true,
              },
              data: { isDefault: false },
            });
            return tx.cardTemplate.update({ where: { id: req.params.id }, data });
          },
          { isolationLevel: "Serializable" }
        )
      )
    : await prisma.cardTemplate.update({ where: { id: req.params.id }, data });
  res.json(template);
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.cardTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Template not found");
  assertCompanyAccess(req, existing.companyId);
  await prisma.cardTemplate.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
