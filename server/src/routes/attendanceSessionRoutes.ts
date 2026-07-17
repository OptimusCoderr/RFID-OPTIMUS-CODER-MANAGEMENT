import { Router } from "express";
import * as attendanceSessionController from "../controllers/attendanceSessionController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  encoderIdParams,
  upsertAttendanceSessionBody,
  setOverrideBody,
  attendanceSessionListQuery,
} from "../validators/attendanceSession.js";

const router = Router();

router.use(authenticate);

const OPERATOR_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"] as const;

router.get("/", validate({ query: attendanceSessionListQuery }), attendanceSessionController.listAttendanceSessions);
router.get("/:encoderId", validate({ params: encoderIdParams }), attendanceSessionController.getAttendanceSession);
router.put(
  "/:encoderId",
  requireRole(...OPERATOR_UP),
  validate({ params: encoderIdParams, body: upsertAttendanceSessionBody }),
  attendanceSessionController.upsertAttendanceSession
);
router.patch(
  "/:encoderId/override",
  requireRole(...OPERATOR_UP),
  validate({ params: encoderIdParams, body: setOverrideBody }),
  attendanceSessionController.setAttendanceSessionOverride
);
router.delete(
  "/:encoderId",
  requireRole(...OPERATOR_UP),
  validate({ params: encoderIdParams }),
  attendanceSessionController.deleteAttendanceSession
);

export default router;
