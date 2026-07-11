import { createServer } from "http";
import cron from "node-cron";
import { createApp } from "./app";
import { initWebsocket } from "./websocket";
import { env } from "./config/env";
import { checkExpiringCards } from "./jobs/expiringCardsJob";

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
