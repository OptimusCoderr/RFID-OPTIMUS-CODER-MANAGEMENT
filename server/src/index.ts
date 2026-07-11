import { createServer } from "http";
import { createApp } from "./app";
import { initWebsocket } from "./websocket";
import { env } from "./config/env";

const app = createApp();
const httpServer = createServer(app);
initWebsocket(httpServer);

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`RFID Management API listening on port ${env.port} [${env.nodeEnv}]`);
});

process.on("SIGTERM", () => httpServer.close());
process.on("SIGINT", () => httpServer.close());
