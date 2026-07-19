import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { assertCompanyAccess, scopedCompanyId } from "../middleware/rbac.js";
import { toCsv } from "../utils/csv.js";
import * as attendanceService from "../services/attendanceService.js";

function buildAttendanceWhere(req: Request): Prisma.AttendanceRecordWhereInput {
  const companyId = scopedCompanyId(req);
  const { holderId, cardId, zoneId, encoderId, sessionId, sessionLabel, type, from, to } = req.query as unknown as {
    holderId?: string;
    cardId?: string;
    zoneId?: string;
    encoderId?: string;
    sessionId?: string;
    sessionLabel?: string;
    type?: "CHECK_IN" | "CHECK_OUT";
    from?: Date;
    to?: Date;
  };

  return {
    ...(companyId ? { companyId } : {}),
    ...(holderId ? { holderId } : {}),
    ...(cardId ? { cardId } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(encoderId ? { encoderId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionLabel ? { sessionLabel: { equals: sessionLabel, mode: "insensitive" } } : {}),
    ...(type ? { type } : {}),
    ...(from || to ? { recordedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
}

export const recordAttendance = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const record = await attendanceService.recordAttendance({
    companyId,
    cardId: req.body.cardId,
    zoneId: req.body.zoneId,
    encoderId: req.body.encoderId,
  });

  res.status(201).json(record);
});

export const recordManualAttendance = asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.user!.role === "SUPER_ADMIN" ? req.body.companyId : req.user!.companyId;
  if (!companyId) throw ApiError.badRequest("companyId is required");

  const record = await attendanceService.recordManualAttendance({
    companyId,
    holderId: req.body.holderId,
    zoneId: req.body.zoneId,
    recordedByUserId: req.user!.id,
  });

  res.status(201).json(record);
});

export const listAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = req.query as unknown as { page: number; pageSize: number };
  const where = buildAttendanceWhere(req);

  const [total, records] = await Promise.all([
    prisma.attendanceRecord.count({ where }),
    prisma.attendanceRecord.findMany({
      where,
      include: attendanceService.ATTENDANCE_INCLUDE,
      orderBy: { recordedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ data: records, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

const EXPORT_ROW_LIMIT = 10_000;

export const exportAttendance = asyncHandler(async (req: Request, res: Response) => {
  const where = buildAttendanceWhere(req);
  const records = await prisma.attendanceRecord.findMany({
    where,
    include: attendanceService.ATTENDANCE_INCLUDE,
    orderBy: { recordedAt: "desc" },
    take: EXPORT_ROW_LIMIT,
  });

  const csv = toCsv(records, [
    { key: "recordedAt", header: "When", value: (r) => r.recordedAt.toISOString() },
    { key: "type", header: "Type", value: (r) => r.type },
    { key: "holder", header: "Holder", value: (r) => r.holder?.fullName },
    { key: "employeeId", header: "ID number", value: (r) => r.holder?.employeeId },
    { key: "department", header: "Department", value: (r) => r.holder?.department },
    { key: "zone", header: "Zone", value: (r) => r.zone?.name },
    { key: "card", header: "Card", value: (r) => r.card?.label ?? r.card?.uid },
    { key: "encoder", header: "Encoder", value: (r) => r.encoder?.name },
    { key: "schedule", header: "Schedule", value: (r) => r.sessionLabel },
    // Manual entries have no card at all (see recordManualAttendance) — the
    // "Card" column above is blank for them either way, which looked
    // identical to a data-integrity gap until these two were added.
    { key: "manualEntry", header: "Manual entry", value: (r) => (r.manualEntry ? "Yes" : "No") },
    { key: "recordedBy", header: "Recorded by", value: (r) => r.recordedByUser?.fullName },
  ]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

export const updateAttendance = asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.attendanceRecord.findUnique({ where: { id: req.params.id } });
  if (!existing) throw ApiError.notFound("Attendance record not found");
  assertCompanyAccess(req, existing.companyId);

  const record = await prisma.attendanceRecord.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.type ? { type: req.body.type } : {}),
      ...(req.body.recordedAt ? { recordedAt: req.body.recordedAt } : {}),
    },
    include: attendanceService.ATTENDANCE_INCLUDE,
  });
  res.json(record);
});

// Bulk-deletes whatever the caller's current filters match — e.g. clearing a
// zone's history so its check-in/check-out toggle (scoped by zone, not by
// schedule — see recordAttendance) starts fresh for a brand-new schedule
// that reuses that zone, instead of immediately reading as "already checked
// in" from a previous schedule's leftover state.
export const clearAttendance = asyncHandler(async (req: Request, res: Response) => {
  const where = buildAttendanceWhere(req);
  const { count } = await prisma.attendanceRecord.deleteMany({ where });
  res.json({ deleted: count });
});
