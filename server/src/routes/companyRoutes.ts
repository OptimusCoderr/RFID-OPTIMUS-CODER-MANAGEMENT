import { Router } from "express";
import * as companyController from "../controllers/companyController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createCompanyBody, updateCompanyBody } from "../validators/company.js";
import { idParams } from "../validators/common.js";

const router = Router();

router.use(authenticate);

router.get("/", companyController.listCompanies);
router.get("/:id", validate({ params: idParams }), companyController.getCompany);
router.post("/", requireRole("SUPER_ADMIN"), validate({ body: createCompanyBody }), companyController.createCompany);
router.patch(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ params: idParams, body: updateCompanyBody }),
  companyController.updateCompany
);
router.delete("/:id", requireRole("SUPER_ADMIN"), validate({ params: idParams }), companyController.deleteCompany);

export default router;
