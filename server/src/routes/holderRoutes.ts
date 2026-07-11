import { Router } from "express";
import * as holderController from "../controllers/holderController";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createHolderBody, updateHolderBody } from "../validators/holder";
import { idParams } from "../validators/common";

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
