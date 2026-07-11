import { Router } from "express";
import * as templateController from "../controllers/templateController";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createTemplateBody, updateTemplateBody } from "../validators/template";
import { idParams } from "../validators/common";

const router = Router();

router.use(authenticate);

router.get("/", templateController.listTemplates);
router.get("/:id", validate({ params: idParams }), templateController.getTemplate);
router.post(
  "/",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate({ body: createTemplateBody }),
  templateController.createTemplate
);
router.patch(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate({ params: idParams, body: updateTemplateBody }),
  templateController.updateTemplate
);
router.delete(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  validate({ params: idParams }),
  templateController.deleteTemplate
);

export default router;
