import { Router } from "express";
import * as encoderController from "../controllers/encoderController";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createEncoderBody, updateEncoderBody } from "../validators/encoder";
import { idParams } from "../validators/common";

const router = Router();

router.use(authenticate);

router.get("/", encoderController.listEncoders);
router.get("/:id", validate({ params: idParams }), encoderController.getEncoder);
router.post(
  "/",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ body: createEncoderBody }),
  encoderController.createEncoder
);
router.patch(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ params: idParams, body: updateEncoderBody }),
  encoderController.updateEncoder
);
router.post(
  "/:id/rotate-key",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ params: idParams }),
  encoderController.rotateEncoderKey
);
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ params: idParams }),
  encoderController.deleteEncoder
);

export default router;
