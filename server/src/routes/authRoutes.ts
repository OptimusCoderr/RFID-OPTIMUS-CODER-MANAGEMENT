import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import * as authController from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { registerCompanyBody } from "../validators/auth.js";

const router = Router();

// Sign-in/up/out, forgot/reset-password, session listing/revocation, and JWT
// minting are all handled by better-auth's own routes, mounted separately in
// app.ts (POST /api/auth/sign-in/email, /sign-up/email, /sign-out,
// /request-password-reset, /reset-password, GET /list-sessions, POST
// /revoke-session, GET /token, GET /jwks, etc). This router only carries the
// app-specific pieces layered on top.
//
// The global express.json() is mounted *after* better-auth's catch-all (it
// needs the raw request stream), so any route here that needs a parsed body
// applies express.json() itself, scoped to just that one route — applying
// it router-wide would consume the body stream for every /api/auth/* request
// that falls through unmatched to better-auth's handler, breaking it.
const json = express.json({ limit: "1mb" });

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  "/register-company",
  json,
  registerLimiter,
  validate({ body: registerCompanyBody }),
  authController.registerCompany
);
router.get("/me", authenticate, authController.me);

// better-auth's own POST /sign-up/email is never called by this app's
// client — the only sign-up paths are /register-company above (self-service)
// and POST /api/users (admin-created, authenticated+RBAC-checked), both of
// which call auth.api.signUpEmail() programmatically rather than over HTTP.
// role/companyId being input:false (see auth/index.ts) already stops the
// raw endpoint from being useful for privilege escalation, but there's still
// no legitimate reason to let it create accounts at all, so it's blocked
// outright here — matched before app.ts's catch-all forwards everything
// else under /api/auth/* to better-auth.
router.post("/sign-up/email", (_req, res) => {
  res.status(404).json({ message: "Not found" });
});

export default router;
