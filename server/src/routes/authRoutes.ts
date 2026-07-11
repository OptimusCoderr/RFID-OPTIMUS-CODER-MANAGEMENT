import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as authController from "../controllers/authController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loginBody, refreshBody, forgotPasswordBody, resetPasswordBody, updateProfileBody } from "../validators/auth";

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

router.post("/login", loginLimiter, validate({ body: loginBody }), authController.login);
router.post("/refresh", validate({ body: refreshBody }), authController.refresh);
router.post("/logout", validate({ body: refreshBody }), authController.logout);
router.get("/me", authenticate, authController.me);
router.patch("/me", authenticate, validate({ body: updateProfileBody }), authController.updateProfile);
router.post("/forgot-password", resetLimiter, validate({ body: forgotPasswordBody }), authController.forgotPassword);
router.post("/reset-password", resetLimiter, validate({ body: resetPasswordBody }), authController.resetPassword);

export default router;
