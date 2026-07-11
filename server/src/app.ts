import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

import authRoutes from "./routes/authRoutes";
import companyRoutes from "./routes/companyRoutes";
import userRoutes from "./routes/userRoutes";
import holderRoutes from "./routes/holderRoutes";
import encoderRoutes from "./routes/encoderRoutes";
import templateRoutes from "./routes/templateRoutes";
import cardRoutes from "./routes/cardRoutes";
import zoneRoutes from "./routes/zoneRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import logRoutes from "./routes/logRoutes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
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

  app.use("/api/auth", authRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/holders", holderRoutes);
  app.use("/api/encoders", encoderRoutes);
  app.use("/api/templates", templateRoutes);
  app.use("/api/cards", cardRoutes);
  app.use("/api/zones", zoneRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/logs", logRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
