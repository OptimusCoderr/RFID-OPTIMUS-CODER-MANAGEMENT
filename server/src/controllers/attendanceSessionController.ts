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

export const listAttendanceSessions = asyncHandler(async (req: Request, res: Response) => {
  const companyId = scopedCompanyId(req);
  const sessions = await prisma.attendanceSession.findMany({
    where: companyId ? { companyId } : {},
    include: SESSION_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  res.json(sessions.map(withState));
});

export const getAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const encoder = await prisma.encoder.findUnique({ where: { id: req.params.encoderId } });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);

  const session = await prisma.attendanceSession.findUnique({
    where: { encoderId: req.params.encoderId },
    include: SESSION_INCLUDE,
  });
  if (!session) {
    res.json(null);
    return;
  }
  res.json(withState(session));
});

export const upsertAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const encoder = await prisma.encoder.findUnique({ where: { id: req.params.encoderId } });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);

  const { zoneId, label, description, daysOfWeek, startTime, endTime } = req.body;
  if (zoneId) {
    const zone = await prisma.accessZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.companyId !== encoder.companyId) {
      throw ApiError.badRequest("Zone does not belong to this company");
    }
  }

  const session = await prisma.attendanceSession.upsert({
    where: { encoderId: req.params.encoderId },
    create: {
      companyId: encoder.companyId,
      encoderId: encoder.id,
      zoneId: zoneId ?? undefined,
      label,
      description: description ?? undefined,
      daysOfWeek,
      startTime: startTime ?? undefined,
      endTime: endTime ?? undefined,
    },
    update: {
      zoneId: zoneId ?? null,
      label,
      description: description ?? null,
      daysOfWeek,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
    },
    include: SESSION_INCLUDE,
  });

  res.json(withState(session));
});

export const setAttendanceSessionOverride = asyncHandler(async (req: Request, res: Response) => {
  const encoder = await prisma.encoder.findUnique({ where: { id: req.params.encoderId } });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);

  const { manualOverride } = req.body;
  // A session row may not exist yet if the encoder has no recurring
  // schedule saved — Start Now / Stop Now must still work standalone, so
  // this creates an override-only row (empty daysOfWeek) in that case.
  // label is required schema-wide, but there's no user-entered one at this
  // point (no schedule form was submitted) — default to the encoder's own
  // name, editable later from the schedule form like any other label.
  const session = await prisma.attendanceSession.upsert({
    where: { encoderId: req.params.encoderId },
    create: {
      companyId: encoder.companyId,
      encoderId: encoder.id,
      label: encoder.name,
      daysOfWeek: [],
      manualOverride,
    },
    update: { manualOverride },
    include: SESSION_INCLUDE,
  });

  res.json(withState(session));
});

export const deleteAttendanceSession = asyncHandler(async (req: Request, res: Response) => {
  const encoder = await prisma.encoder.findUnique({ where: { id: req.params.encoderId } });
  if (!encoder) throw ApiError.notFound("Encoder not found");
  assertCompanyAccess(req, encoder.companyId);

  await prisma.attendanceSession.deleteMany({ where: { encoderId: req.params.encoderId } });
  res.status(204).send();
});
