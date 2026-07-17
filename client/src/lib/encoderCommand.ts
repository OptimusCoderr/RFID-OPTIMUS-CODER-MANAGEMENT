import type { Socket } from "socket.io-client";

export interface EncoderCommandOutcome {
  success: boolean;
  data?: unknown;
  error?: string;
}

const ACK_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 15_000;

// The "Send command" form on Live Encode fires a command and just watches the
// shared event log for whatever comes back. Multi-block flows (reading/writing
// several card-data fields in sequence) need to know which result belongs to
// which command, and need to wait for one step before starting the next —
// this wraps the emit + matching "encoder:commandResult" broadcast into a
// single awaitable call.
//
// Two distinct waits, two distinct timeouts: `.timeout()` bounds the initial
// ack (the server accepting/rejecting the command) — without it, a dropped
// connection right as the emit goes out leaves this promise pending forever,
// since socket.io never invokes an ack callback that never arrives. The
// second setTimeout bounds the actual hardware response, which arrives on a
// separate broadcast, not the ack itself.
export function sendCommandAwait(
  socket: Socket,
  encoderId: string,
  command: string,
  args: Record<string, unknown>,
  cardId?: string
): Promise<EncoderCommandOutcome> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit(
        "encoder:command",
        { encoderId, command, args, cardId },
        (err: Error | null, ack?: { ok: boolean; commandId?: string; error?: string }) => {
          if (err) {
            reject(new Error("Timed out waiting for the server to accept the command"));
            return;
          }
          if (!ack || !ack.ok || !ack.commandId) {
            reject(new Error(ack?.error ?? "Command rejected"));
            return;
          }

          const commandId = ack.commandId;
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for the encoder to respond"));
          }, RESPONSE_TIMEOUT_MS);

          function onResult(payload: { commandId: string; success: boolean; data?: unknown; error?: string }) {
            if (payload.commandId !== commandId) return;
            cleanup();
            resolve({ success: payload.success, data: payload.data, error: payload.error });
          }

          function cleanup() {
            clearTimeout(timeout);
            socket.off("encoder:commandResult", onResult);
          }

          socket.on("encoder:commandResult", onResult);
        }
      );
  });
}
