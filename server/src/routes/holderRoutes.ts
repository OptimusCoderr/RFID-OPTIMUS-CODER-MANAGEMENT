import { Router } from "express";
import * as holderController from "../controllers/holderController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createHolderBody, updateHolderBody } from "../validators/holder.js";
import { idParams } from "../validators/common.js";

const router = Router();

router.use(authenticate);

router.get("/", holderController.listHolders);
router.get("/:id", validate({ params: idParams }), holderController.getHolder);
router.post(
  "/",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"),
  validate({ body: createHolderBody }),
  holderController.createHolder
);
router.patch(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"),
  validate({ params: idParams, body: updateHolderBody }),
  holderController.updateHolder
);
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate({ params: idParams }),
  holderController.deleteHolder
);

export default router;
