import { Router } from "express";
import * as maintenanceController from "../controllers/maintenanceController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { openMaintenanceBody, updateMaintenanceBody, maintenanceListQuery } from "../validators/maintenance.js";
import { idParams } from "../validators/common.js";

const router = Router();

router.use(authenticate);

const OPERATOR_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"] as const;

router.get("/", validate({ query: maintenanceListQuery }), maintenanceController.listMaintenance);
router.post("/", requireRole(...OPERATOR_UP), validate({ body: openMaintenanceBody }), maintenanceController.openMaintenance);
router.patch(
  "/:id",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: updateMaintenanceBody }),
  maintenanceController.updateMaintenance
);

export default router;
