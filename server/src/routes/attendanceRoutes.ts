import { Router } from "express";
import * as attendanceController from "../controllers/attendanceController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { recordAttendanceBody, recordManualAttendanceBody, attendanceListQuery } from "../validators/attendance.js";

const router = Router();

router.use(authenticate);

const OPERATOR_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"] as const;
// Manual entry bypasses the normal card requirement entirely, so it's held
// to the same tier as other lifecycle overrides (block/retire/write-protect)
// rather than the lower OPERATOR_UP tier ordinary taps use.
const MANAGER_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] as const;

router.get("/", validate({ query: attendanceListQuery }), attendanceController.listAttendance);
router.get("/export", validate({ query: attendanceListQuery }), attendanceController.exportAttendance);
router.post("/", requireRole(...OPERATOR_UP), validate({ body: recordAttendanceBody }), attendanceController.recordAttendance);
router.post(
  "/manual",
  requireRole(...MANAGER_UP),
  validate({ body: recordManualAttendanceBody }),
  attendanceController.recordManualAttendance
);

export default router;
