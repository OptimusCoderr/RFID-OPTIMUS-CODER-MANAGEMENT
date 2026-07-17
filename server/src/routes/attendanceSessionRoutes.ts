import { Router } from "express";
import * as attendanceSessionController from "../controllers/attendanceSessionController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { idParams } from "../validators/common.js";
import {
  createAttendanceSessionBody,
  updateAttendanceSessionBody,
  setOverrideBody,
  attendanceSessionListQuery,
} from "../validators/attendanceSession.js";

const router = Router();

router.use(authenticate);

const OPERATOR_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"] as const;

router.get("/", validate({ query: attendanceSessionListQuery }), attendanceSessionController.listAttendanceSessions);
router.post(
  "/",
  requireRole(...OPERATOR_UP),
  validate({ body: createAttendanceSessionBody }),
  attendanceSessionController.createAttendanceSession
);
router.patch(
  "/:id",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: updateAttendanceSessionBody }),
  attendanceSessionController.updateAttendanceSession
);
router.patch(
  "/:id/override",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: setOverrideBody }),
  attendanceSessionController.setAttendanceSessionOverride
);
router.delete(
  "/:id",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams }),
  attendanceSessionController.deleteAttendanceSession
);

export default router;
