import { Router } from "express";
import * as zoneController from "../controllers/zoneController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createZoneBody, updateZoneBody, zoneCardsBody, zoneEncodersBody } from "../validators/zone.js";
import { idParams } from "../validators/common.js";

const router = Router();

router.use(authenticate);

const MANAGER_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] as const;

router.get("/", zoneController.listZones);
router.get("/:id", validate({ params: idParams }), zoneController.getZone);
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
router.post(
  "/:id/grant-encoders",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: zoneEncodersBody }),
  zoneController.grantZoneEncoders
);
router.post(
  "/:id/revoke-encoders",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: zoneEncodersBody }),
  zoneController.revokeZoneEncoders
);

export default router;
