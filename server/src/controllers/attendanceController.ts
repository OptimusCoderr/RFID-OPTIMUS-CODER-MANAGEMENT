import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { scopedCompanyId } from "../middleware/rbac.js";
import { toCsv } from "../utils/csv.js";
import * as attendanceService from "../services/attendanceService.js";

function buildAttendanceWhere(req: Request): Prisma.AttendanceRecordWhereInput {
  const companyId = scopedCompanyId(req);
  const { holderId, cardId, zoneId, type, from, to } = req.query as unknown as {
    holderId?: string;
    cardId?: string;
    zoneId?: string;
    type?: "CHECK_IN" | "CHECK_OUT";
    from?: Date;
    to?: Date;
  };

  return {
    ...(companyId ? { companyId } : {}),
    ...(holderId ? { holderId } : {}),
    ...(cardId ? { cardId } : {}),
    ...(zoneId ? { zoneId } : {}),
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
  ]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});
