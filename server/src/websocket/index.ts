import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { v4 as uuid } from "uuid";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { env } from "../config/env.js";
import { logOperation } from "../services/operationLogService.js";
import { notifyCompanyAdmins } from "../services/notificationService.js";
import { isProtectedMifareBlock } from "../utils/mifare.js";
import { OperationType } from "@prisma/client";

interface DashboardSocketData {
  userId: string;
  role: string;
  companyId: string | null;
}

interface AgentSocketData {
  encoderId: string;
  companyId: string;
}

// Maps encoder command types to the OperationLog enum for audit purposes.
const COMMAND_TO_OPERATION: Record<string, OperationType> = {
  READ: "READ",
  WRITE: "WRITE",
  FORMAT: "FORMAT",
  LOCK: "LOCK",
  KEY_CHANGE: "KEY_CHANGE",
  CLONE: "CLONE",
  // MIFARE Classic / NTAG raw block-level commands — the ones CardDataPanel,
  // CitizenDataPanel, and the Live Encode "Send command" console actually
  // send. These were missing here, so every card-data read/write (including
  // a delete, which is just a write of zeroed blocks) fell through to the
  // "READ" default below regardless of which one it actually was.
  READ_UID: "READ",
  READ_BLOCK: "READ",
  WRITE_BLOCK: "WRITE",
  READ_NTAG: "READ",
  WRITE_NTAG: "WRITE",
  // MIFARE DESFire application/file partitioning.
  GET_DESFIRE_VERSION: "READ",
  LIST_APPLICATIONS: "READ",
  SELECT_APPLICATION: "READ",
  AUTH_APPLICATION: "READ",
  CREATE_APPLICATION: "CREATE",
  DELETE_APPLICATION: "DELETE",
  GET_FILE_IDS: "READ",
  GET_FILE_SETTINGS: "READ",
  CREATE_FILE: "CREATE",
  DELETE_FILE: "DELETE",
  READ_FILE: "READ",
  WRITE_FILE: "WRITE",
  GET_VALUE: "READ",
  CREDIT_VALUE: "WRITE",
  DEBIT_VALUE: "WRITE",
  READ_RECORDS: "READ",
  WRITE_RECORD: "WRITE",
  FORMAT_PICC: "FORMAT",
};

// Commands that destroy data (wipe a whole card, or delete an
// application/file that other cards' partitions may depend on) — gated to
// MANAGER-and-up, unlike the routine read/write commands which any
// authenticated company member can send.
const DESTRUCTIVE_COMMANDS = new Set(["CREATE_APPLICATION", "DELETE_APPLICATION", "DELETE_FILE", "FORMAT_PICC"]);
const MANAGER_UP_ROLES = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"]);

let io: Server | undefined;

export function initWebsocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  const dashboardNsp = io.of("/dashboard");
  const agentNsp = io.of("/agent");

  // The agent's "command" payload (relayed to hardware) deliberately carries
  // no app-level context — the physical agent has no notion of the app's
  // Card entity or which user asked for this, only block/page numbers. That
  // context is also missing from the "command:result" the agent sends back,
  // which would otherwise leave the audit log unable to say which card (or
  // who) a read/write/delete actually touched. This bridges the gap: it's
  // stashed here at dispatch time, keyed by commandId, and consumed once the
  // matching result arrives. A command whose result never comes back (e.g.
  // the agent disconnects mid-command) leaves its entry stranded, but at
  // this app's realistic command volume that's an acceptable trade for not
  // needing a TTL sweep.
  const pendingCommandContext = new Map<string, { cardId?: string; userId: string }>();

  // --- Dashboard clients (the React app) -----------------------------------
  dashboardNsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("missing token");
      const payload = await verifyAccessToken(token);
      socket.data = { userId: payload.sub, role: payload.role, companyId: payload.companyId } satisfies DashboardSocketData;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  dashboardNsp.on("connection", (socket: Socket) => {
    const data = socket.data as DashboardSocketData;
    if (data.companyId) socket.join(`company:${data.companyId}`);
    if (data.role === "SUPER_ADMIN") socket.join("super-admins");
    socket.join(`user:${data.userId}`);

    // SUPER_ADMIN can attach to a specific company's live feed.
    socket.on("subscribe:company", (companyId: string) => {
      if (data.role === "SUPER_ADMIN" && typeof companyId === "string") {
        socket.join(`company:${companyId}`);
      }
    });

    socket.on(
      "encoder:command",
      async (
        payload: { encoderId: string; command: string; args?: unknown; cardId?: string },
        ack?: (res: { ok: boolean; error?: string; commandId?: string }) => void
      ) => {
        try {
          const encoder = await prisma.encoder.findUnique({ where: { id: payload.encoderId } });
          if (!encoder) throw new Error("Encoder not found");
          if (data.role !== "SUPER_ADMIN" && encoder.companyId !== data.companyId) {
            throw new Error("Forbidden");
          }
          if (encoder.status === "OFFLINE") throw new Error("Encoder is offline");

          if (DESTRUCTIVE_COMMANDS.has(payload.command) && !MANAGER_UP_ROLES.has(data.role)) {
            throw new Error("You do not have permission to run this command");
          }

          // Real protection against writing over a card's manufacturer block
          // or a sector's key trailer — checked here (not just hinted at in
          // the Templates UI) so it also covers Live Encode's raw "Send
          // command" console, which lets a block number be typed freely with
          // no template involved at all.
          if (payload.command === "WRITE_BLOCK") {
            const block = (payload.args as { block?: number } | undefined)?.block;
            if (typeof block === "number" && isProtectedMifareBlock(block)) {
              throw new Error(`Block ${block} is protected (manufacturer block or sector trailer) and cannot be written to`);
            }
          }

          // A "delete card data" write — CardDataPanel/CitizenDataPanel's
          // Delete buttons blank a card's blocks by writing zeros, using the
          // exact same WRITE_BLOCK command as any ordinary field write, so
          // this is the only signal distinguishing the two server-side.
          // Gated the same as the other DESTRUCTIVE_COMMANDS above: hiding
          // the button client-side isn't real protection on its own, since
          // anyone who can call this handler at all could otherwise still
          // send the same command directly.
          const isClearWrite = payload.command === "WRITE_BLOCK" && (payload.args as { clear?: boolean } | undefined)?.clear === true;
          if (isClearWrite && !MANAGER_UP_ROLES.has(data.role)) {
            throw new Error("You do not have permission to delete card data");
          }

          if (payload.cardId) {
            const card = await prisma.card.findUnique({
              where: { id: payload.cardId },
              include: { encoderAllocations: { select: { encoderId: true, expiresAt: true } } },
            });
            const now = new Date();

            // The card's own overall expiry (e.g. a Visitors quick-issue
            // pass — see VisitorsPage) — distinct from an encoder
            // allocation's expiry below. This is checked live rather than
            // relying on the daily cron job that flips a lapsed card's
            // status to EXPIRED: that job only runs once a day, far too
            // coarse for an hours-long visitor pass.
            if (card?.expiresAt && card.expiresAt <= now) {
              throw new Error("This card has expired");
            }

            // Any allocation row at all — expired or not — means this card is
            // meant to be restricted, not left open to every encoder. An
            // allocation that's expired (e.g. a hotel room key past
            // checkout) must revoke access, never silently fall back to
            // "unrestricted" just because its one valid row lapsed.
            if (card && card.encoderAllocations.length > 0) {
              const match = card.encoderAllocations.find((a) => a.encoderId === encoder.id);
              if (!match) throw new Error("This card is not allocated to this encoder");
              if (match.expiresAt && match.expiresAt <= now) {
                throw new Error("This card's access to this encoder has expired");
              }
            }
          }

          const commandId = uuid();
          pendingCommandContext.set(commandId, { cardId: payload.cardId, userId: data.userId });
          agentNsp.to(`encoder:${encoder.id}`).emit("command", {
            commandId,
            command: payload.command,
            args: payload.args ?? {},
            requestedBy: data.userId,
          });
          ack?.({ ok: true, commandId });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "Command failed" });
        }
      }
    );
  });

  // --- Local hardware agents (one process per physical encoder) ------------
  agentNsp.use(async (socket, next) => {
    try {
      const agentKey = socket.handshake.auth?.agentKey as string | undefined;
      if (!agentKey) throw new Error("missing agent key");
      const encoder = await prisma.encoder.findUnique({ where: { agentKey } });
      if (!encoder || !encoder.isActive) throw new Error("unknown or inactive encoder");
      socket.data = { encoderId: encoder.id, companyId: encoder.companyId } satisfies AgentSocketData;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  agentNsp.on("connection", (socket: Socket) => {
    const data = socket.data as AgentSocketData;
    socket.join(`encoder:${data.encoderId}`);

    prisma.encoder
      .update({ where: { id: data.encoderId }, data: { status: "ONLINE", lastSeenAt: new Date() } })
      .then((encoder) => {
        dashboardNsp.to(`company:${data.companyId}`).emit("encoder:status", { encoderId: encoder.id, status: encoder.status });
      })
      .catch(() => undefined);

    socket.on("heartbeat", () => {
      prisma.encoder.update({ where: { id: data.encoderId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    });

    socket.on("card:detected", (payload: { uid: string; cardType?: string; atr?: string }) => {
      dashboardNsp.to(`company:${data.companyId}`).emit("card:detected", { encoderId: data.encoderId, ...payload });
    });

    socket.on(
      "command:result",
      async (payload: { commandId: string; command: string; success: boolean; data?: unknown; error?: string }) => {
        dashboardNsp.to(`company:${data.companyId}`).emit("encoder:commandResult", { encoderId: data.encoderId, ...payload });

        const context = pendingCommandContext.get(payload.commandId);
        pendingCommandContext.delete(payload.commandId);

        const operationType = COMMAND_TO_OPERATION[payload.command] ?? "READ";
        await logOperation({
          companyId: data.companyId,
          cardId: context?.cardId,
          encoderId: data.encoderId,
          userId: context?.userId,
          operationType,
          status: payload.success ? "SUCCESS" : "FAILED",
          details: payload.data as any,
          errorMessage: payload.error,
        }).catch(() => undefined);
      }
    );

    socket.on("disconnect", () => {
      prisma.encoder
        .update({ where: { id: data.encoderId }, data: { status: "OFFLINE" } })
        .then((encoder) => {
          dashboardNsp.to(`company:${data.companyId}`).emit("encoder:status", { encoderId: encoder.id, status: encoder.status });
          notifyCompanyAdmins(data.companyId, {
            type: "ENCODER_OFFLINE",
            title: "Encoder went offline",
            message: `${encoder.name} disconnected from its local agent.`,
            link: "/encoders",
          }).catch(() => undefined);
        })
        .catch(() => undefined);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Websocket server not initialized");
  return io;
}
