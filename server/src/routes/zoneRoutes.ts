import { Router } from "express";
import * as zoneController from "../controllers/zoneController";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createZoneBody, updateZoneBody, zoneCardsBody } from "../validators/zone";
import { idParams } from "../validators/common";

const router = Router();

router.use(authenticate);

const MANAGER_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] as const;

router.get("/", zoneController.listZones);
router.post("/", requireRole(...MANAGER_UP), validate({ body: createZoneBody }), zoneController.createZone);
router.patch(
  "/:id",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: updateZoneBody }),
  zoneController.updateZone
);
router.delete("/:id", requireRole(...MANAGER_UP), validate({ params: idParams }), zoneController.deleteZone);
router.post(
  "/:id/grant",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: zoneCardsBody }),
  zoneController.grantZoneAccess
);
router.post(
  "/:id/revoke",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: zoneCardsBody }),
  zoneController.revokeZoneAccess
);

export default router;
