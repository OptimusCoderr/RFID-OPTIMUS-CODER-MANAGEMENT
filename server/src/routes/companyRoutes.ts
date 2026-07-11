import { Router } from "express";
import * as companyController from "../controllers/companyController";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { validate } from "../middleware/validate";
import { createCompanyBody, updateCompanyBody } from "../validators/company";
import { idParams } from "../validators/common";

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
