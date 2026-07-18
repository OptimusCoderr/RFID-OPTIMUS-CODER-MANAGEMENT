import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import { computeSessionState } from "../services/attendanceSessionService.js";

const SESSION_INCLUDE = {
  encoder: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
} as const;

function withState<T extends { daysOfWeek: number[]; startTime: string | null; endTime: string | null; manualOverride: "NONE" | "FORCE_OPEN" | "FORCE_CLOSED" }>(
  session: T
) {
  return { ...session, state: computeSessionState(session) };
}

async function loadEncoder(req: Request, encoderId: string) {
  const encoder = await prisma.encoder.findUnique({ where: { id: encoderId } });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);
  return encoder;
}

async function loadSession(req: Request, id: string) {
  const session = await prisma.attendanceSession.findUnique({ where: { id } });
  if (!session) throw ApiError.notFound("Schedule not found");
  assertCompanyAccess(req, session.companyId);
  return session;
}

async function assertZoneBelongsToCompany(zoneId: string | null | undefined, companyId: string) {
  if (!zoneId) return;
  const zone = await prisma.accessZone.findUnique({ where: { id: zoneId } });
  if (!zone || zone.companyId !== companyId) {
    throw ApiError.badRequest("Zone does not belong to this company");
  }
}

export const listAttendanceSessions = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const { encoderId } = req.query as { encoderId?: string };
  const sessions = await prisma.attendanceSession.findMany({
    where: { ...(companyId ? { companyId } : {}), ...(encoderId ? { encoderId } : {}) },
    include: SESSION_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  res.json(sessions.map(withState));
});

export const createAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const { encoderId, zoneId, label, description, daysOfWeek, startTime, endTime, mode } = req.body;
  const encoder = await loadEncoder(req, encoderId);
  await assertZoneBelongsToCompany(zoneId, encoder.companyId);

  const session = await prisma.attendanceSession.create({
    data: {
      companyId: encoder.companyId,
      encoderId: encoder.id,
      zoneId: zoneId ?? undefined,
      label,
      description: description ?? undefined,
      daysOfWeek,
      startTime: startTime ?? undefined,
      endTime: endTime ?? undefined,
      mode,
    },
    include: SESSION_INCLUDE,
  });

  res.status(201).json(withState(session));
});

export const updateAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSession(req, req.params.id);
  const { encoderId, zoneId, label, description, daysOfWeek, startTime, endTime, mode } = req.body;

  // Moving a schedule to a different encoder ("this course changed rooms")
  // — optional, and re-validated against the same company either way.
  const companyId = encoderId ? (await loadEncoder(req, encoderId)).companyId : existing.companyId;
  if (zoneId !== undefined) await assertZoneBelongsToCompany(zoneId, companyId);

  const session = await prisma.attendanceSession.update({
    where: { id: existing.id },
    data: {
      encoderId: encoderId ?? undefined,
      zoneId: zoneId === undefined ? undefined : zoneId,
      label: label ?? undefined,
      description: description === undefined ? undefined : description,
      daysOfWeek: daysOfWeek ?? undefined,
      startTime: startTime === undefined ? undefined : startTime,
      endTime: endTime === undefined ? undefined : endTime,
      mode: mode ?? undefined,
    },
    include: SESSION_INCLUDE,
  });

  res.json(withState(session));
});

export const setAttendanceSessionOverride = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSession(req, req.params.id);
  const { manualOverride } = req.body;

  const session = await prisma.attendanceSession.update({
    where: { id: existing.id },
    data: { manualOverride },
    include: SESSION_INCLUDE,
  });

  res.json(withState(session));
});

export const deleteAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSession(req, req.params.id);
  await prisma.attendanceSession.delete({ where: { id: existing.id } });
  res.status(204).send();
});
