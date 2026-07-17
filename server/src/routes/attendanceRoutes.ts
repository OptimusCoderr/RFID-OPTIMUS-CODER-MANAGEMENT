import { Router } from "express";
import * as attendanceController from "../controllers/attendanceController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { recordAttendanceBody, attendanceListQuery } from "../validators/attendance.js";

const router = Router();

router.use(authenticate);

const OPERATOR_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"] as const;

router.get("/", validate({ query: attendanceListQuery }), attendanceController.listAttendance);
router.get("/export", validate({ query: attendanceListQuery }), attendanceController.exportAttendance);
router.post("/", requireRole(...OPERATOR_UP), validate({ body: recordAttendanceBody }), attendanceController.recordAttendance);

export default router;
