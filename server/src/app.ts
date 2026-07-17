import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/index.js";
import { env } from "./config/env.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

import authRoutes from "./routes/authRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import holderRoutes from "./routes/holderRoutes.js";
import encoderRoutes from "./routes/encoderRoutes.js";
import templateRoutes from "./routes/templateRoutes.js";
import cardRoutes from "./routes/cardRoutes.js";
import zoneRoutes from "./routes/zoneRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import maintenanceRoutes from "./routes/maintenanceRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import logRoutes from "./routes/logRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import agentPackageRoutes from "./routes/agentPackageRoutes.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  // Our own auth endpoints beyond better-auth's built-ins (self-service
  // company registration, and a profile shape that joins the company
  // record) — registered before the catch-all so Express matches these
  // more specific routes first.
  app.use("/api/auth", authRoutes);
  // better-auth owns everything else under /api/auth/* (sign-in/up/out,
  // forgot/reset-password, session listing/revocation, JWT minting, JWKS).
  // Must be mounted before express.json() — better-auth parses the raw
  // request body itself.
  app.all("/api/auth/*", toNodeHandler(auth));

  app.use(express.json({ limit: "1mb" }));
  app.use("/api/companies", companyRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/holders", holderRoutes);
  app.use("/api/encoders", encoderRoutes);
  app.use("/api/templates", templateRoutes);
  app.use("/api/cards", cardRoutes);
  app.use("/api/zones", zoneRoutes);
  app.use("/api/attendance", attendanceRoutes);
  app.use("/api/maintenance", maintenanceRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/logs", logRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/agent-package", agentPackageRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
