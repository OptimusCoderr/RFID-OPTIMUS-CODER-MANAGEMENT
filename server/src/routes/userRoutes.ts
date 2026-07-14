import { Router } from "express";
import * as userController from "../controllers/userController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import { createUserBody, updateUserBody } from "../validators/user.js";
import { idParams } from "../validators/common.js";

const router = Router();

router.use(authenticate);

router.get("/", userController.listUsers);
router.get("/:id", validate({ params: idParams }), userController.getUser);
router.post(
  "/",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ body: createUserBody }),
  userController.createUser
);
router.patch(
  "/:id",
  requireRole("SUPER_ADMIN", "COMPANY_ADMIN"),
  validate({ params: idParams, body: updateUserBody }),
  userController.updateUser
);
router.delete("/:id", requireRole("SUPER_ADMIN", "COMPANY_ADMIN"), validate({ params: idParams }), userController.deleteUser);

export default router;
