import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import { generateAgentKey } from "../utils/crypto.js";

const SAFE_SELECT = {
  id: true,
  companyId: true,
  name: true,
  type: true,
  connectionType: true,
  serialNumber: true,
  location: true,
  firmwareVersion: true,
  status: true,
  lastSeenAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  // agentKey intentionally omitted — only surfaced once, at creation/rotation
} as const;

export const listEncoders = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const encoders = await prisma.encoder.findMany({
    where: companyId ? { companyId } : {},
    select: SAFE_SELECT,
    orderBy: { name: "asc" },
  });
  res.json(encoders);
});

export const getEncoder = asyncHandler(async (req: Request, res: Response) => {
  const encoder = await prisma.encoder.findUnique({ where: { id: req.params.id }, select: SAFE_SELECT });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);
  res.json(encoder);
});

export const createEncoder = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");
  const agentKey = generateAgentKey();
  const encoder = await prisma.encoder.create({ data: { ...req.body, companyId, agentKey } });
  // Return the agentKey exactly once — the local agent process must be configured with it now.
  res.status(201).json({ ...encoder, agentKey });
});

export const updateEncoder = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.encoder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, existing.companyId);
  const { companyId: _ignored, ...data } = req.body;
  const encoder = await prisma.encoder.update({ where: { id: req.params.id }, data, select: SAFE_SELECT });
  res.json(encoder);
});

export const rotateEncoderKey = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.encoder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, existing.companyId);
  const agentKey = generateAgentKey();
  const encoder = await prisma.encoder.update({
    where: { id: req.params.id },
    data: { agentKey, status: "OFFLINE" },
  });
  res.json({ ...encoder, agentKey });
});

export const deleteEncoder = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.encoder.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, existing.companyId);
  await prisma.encoder.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
