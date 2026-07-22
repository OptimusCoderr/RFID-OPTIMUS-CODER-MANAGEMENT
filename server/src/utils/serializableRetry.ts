import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

// A check-then-act sequence (read the current state, decide, write) run
// inside a Prisma Serializable transaction is safe against concurrent
// requests racing each other — Postgres detects the conflict and aborts one
// of the two transactions with a serialization failure (Prisma error code
// P2034) instead of letting both proceed against stale reads. This wraps
// that retry: re-run the transaction once against the now-committed state
// rather than surfacing the failure to the caller.
export async function withSerializableRetry<T>(fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isSerializationFailure = err instanceof Error && "code" in err && (err as { code?: string }).code === "P2034";
      if (!isSerializationFailure || attempt === maxAttempts - 1) throw err;
      // Small randomized backoff so a burst of simultaneously-retried
      // transactions doesn't just collide again on the very next attempt.
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
    }
  }
  throw new Error("unreachable"); // the loop above always returns or throws
}

// Every check-then-act transaction in this codebase pairs Serializable
// isolation with the retry above — this is that pairing as one call instead
// of each call site re-nesting withSerializableRetry(() => prisma.$transaction(...)).
export function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, maxAttempts = 8): Promise<T> {
  return withSerializableRetry(() => prisma.$transaction(fn, { isolationLevel: "Serializable" }), maxAttempts);
}
