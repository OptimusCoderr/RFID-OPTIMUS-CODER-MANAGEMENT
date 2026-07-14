import { Router } from "express";
import * as templateController from "../controllers/templateController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createTemplateBody, updateTemplateBody } from "../validators/template.js";
import { idParams } from "../validators/common.js";

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
