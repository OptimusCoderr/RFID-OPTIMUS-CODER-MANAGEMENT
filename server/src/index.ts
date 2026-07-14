import { createServer } from "http";
import cron from "node-cron";

async function main() {
  // Zero-config local dev: unless a real DATABASE_URL is already configured,
  // provision and use a local embedded PostgreSQL instance. Never applies in
  // production, where a real DATABASE_URL is required.
  if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production") {
    const { ensureDevEnvironment } = await import("./devtools/localDb.js");
    await ensureDevEnvironment();
  }

  // The downloadable agent package (server/agent-dist/) is a build artifact;
  // in production it's built into the Docker image ahead of time, but local
  // dev entry points that bypass npm's pre-hooks (e.g. launching tsx
  // directly from an IDE) need it generated on first boot.
  if (process.env.NODE_ENV !== "production") {
    const { ensureAgentDistBuilt } = await import("./devtools/agentDist.js");
    ensureAgentDistBuilt();
  }

  const { createApp } = await import("./app.js");
  const { initWebsocket } = await import("./websocket/index.js");
  const { env } = await import("./config/env.js");
  const { checkExpiringCards } = await import("./jobs/expiringCardsJob.js");

  const app = createApp();
  const httpServer = createServer(app);
  initWebsocket(httpServer);

  httpServer.listen(env.port, () => {
    console.log(`RFID Management API listening on port ${env.port} [${env.nodeEnv}]`);
  });

  // Daily sweep for cards nearing/at expiry — also run once shortly after boot
  // so the feature is visible without waiting for the next scheduled tick.
  cron.schedule("0 8 * * *", () => {
    checkExpiringCards().catch((err) => console.error("[cron] expiring cards check failed:", err));
  });
  setTimeout(() => {
    checkExpiringCards().catch((err) => console.error("[startup] expiring cards check failed:", err));
  }, 5000);

  process.on("SIGTERM", () => httpServer.close());
  process.on("SIGINT", () => httpServer.close());
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
