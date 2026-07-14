import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as authController from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  loginBody,
  refreshBody,
  forgotPasswordBody,
  resetPasswordBody,
  updateProfileBody,
  registerCompanyBody,
} from "../validators/auth.js";
import { idParams } from "../validators/common.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, validate({ body: loginBody }), authController.login);
router.post(
  "/register-company",
  registerLimiter,
  validate({ body: registerCompanyBody }),
  authController.registerCompany
);
router.post("/refresh", validate({ body: refreshBody }), authController.refresh);
router.post("/logout", validate({ body: refreshBody }), authController.logout);
router.get("/me", authenticate, authController.me);
router.patch("/me", authenticate, validate({ body: updateProfileBody }), authController.updateProfile);
router.post("/forgot-password", resetLimiter, validate({ body: forgotPasswordBody }), authController.forgotPassword);
router.post("/reset-password", resetLimiter, validate({ body: resetPasswordBody }), authController.resetPassword);
router.get("/sessions", authenticate, authController.listSessions);
router.delete("/sessions/:id", authenticate, validate({ params: idParams }), authController.revokeSession);

export default router;
