// Standalone local agent — run this on the machine that has a physical
// USB/serial RFID/NFC encoder plugged into it (ACR122U, ACR1252U, PN532, etc).
//
// It bridges the physical reader to the cloud RFID Management API over a
// websocket, so the web dashboard can trigger live read/write operations
// no matter where the browser is running.
//
// Usage:
//   AGENT_SERVER_URL=https://your-server AGENT_KEY=<encoder agentKey> npm run agent
//
// The agentKey is issued when an encoder is registered in the dashboard
// (Encoders -> Add Encoder). It is shown once — store it safely.

import "dotenv/config";
import { io } from "socket.io-client";
import { PcscBridge, DetectedCard } from "../hardware/pcscBridge";

const SERVER_URL = process.env.AGENT_SERVER_URL ?? "http://localhost:4000";
const AGENT_KEY = process.env.AGENT_KEY;

if (!AGENT_KEY) {
  console.error("Missing AGENT_KEY. Set it to the agent key shown when the encoder was registered.");
  process.exit(1);
}

const bridge = new PcscBridge();
const socket = io(`${SERVER_URL}/agent`, {
  auth: { agentKey: AGENT_KEY },
  reconnection: true,
  reconnectionDelay: 2000,
});

let lastCard: DetectedCard | null = null;
let lastReaderName: string | undefined;

socket.on("connect", () => {
  console.log(`[agent] connected to ${SERVER_URL} (socket ${socket.id})`);
});

socket.on("connect_error", (err) => {
  console.error(`[agent] connection error: ${err.message}`);
});

socket.on("disconnect", (reason) => {
  console.warn(`[agent] disconnected: ${reason}`);
});

setInterval(() => {
  if (socket.connected) socket.emit("heartbeat");
}, 30_000);

bridge.onReaderConnected = (name) => console.log(`[agent] reader connected: ${name}`);
bridge.onReaderDisconnected = (name) => console.log(`[agent] reader disconnected: ${name}`);
bridge.onError = (err) => console.error(`[agent] hardware error: ${err.message}`);

bridge.onCardDetected = (readerName, card) => {
  lastCard = card;
  lastReaderName = readerName;
  console.log(`[agent] card detected on ${readerName}: uid=${card.uid}`);
  socket.emit("card:detected", card);
};

bridge.onCardRemoved = (readerName) => {
  if (lastReaderName === readerName) lastCard = null;
  console.log(`[agent] card removed from ${readerName}`);
};

interface CommandPayload {
  commandId: string;
  command: string;
  args?: Record<string, unknown>;
}

socket.on("command", async ({ commandId, command, args = {} }: CommandPayload) => {
  console.log(`[agent] command received: ${command} (${commandId})`);
  try {
    const data = await runCommand(command, args);
    socket.emit("command:result", { commandId, command, success: true, data });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    console.error(`[agent] command failed: ${command} — ${error}`);
    socket.emit("command:result", { commandId, command, success: false, error });
  }
});

async function runCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case "READ_UID": {
      if (!lastCard) throw new Error("No card present on the reader");
      return { uid: lastCard.uid, atr: lastCard.atr, standard: lastCard.standard };
    }
    case "READ_BLOCK": {
      const { block, key, keyType } = args as { block: number; key: string; keyType?: "A" | "B" };
      const data = await bridge.readMifareClassicBlock(lastReaderName, block, key, keyType ?? "A");
      return { block, data };
    }
    case "WRITE_BLOCK": {
      const { block, data, key, keyType } = args as { block: number; data: string; key: string; keyType?: "A" | "B" };
      await bridge.writeMifareClassicBlock(lastReaderName, block, data, key, keyType ?? "A");
      return { block, written: true };
    }
    case "READ_NTAG": {
      const { page, pageCount } = args as { page: number; pageCount?: number };
      const data = await bridge.readNtagPage(lastReaderName, page, pageCount ?? 1);
      return { page, data };
    }
    case "WRITE_NTAG": {
      const { page, data } = args as { page: number; data: string };
      await bridge.writeNtagPage(lastReaderName, page, data);
      return { page, written: true };
    }
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

try {
  bridge.start();
  console.log("[agent] watching for PC/SC readers...");
} catch (err) {
  console.error(`[agent] ${err instanceof Error ? err.message : err}`);
  console.error("[agent] the websocket bridge is still running so you can diagnose connectivity, but no hardware is attached.");
}
