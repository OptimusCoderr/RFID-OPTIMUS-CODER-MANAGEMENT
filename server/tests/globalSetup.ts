import { execSync } from "child_process";
import { ensureLocalDatabase, stopLocalDatabase } from "../src/devtools/localDb";

// A dedicated database so integration tests never touch real dev/prod data.
// Respects a real DATABASE_URL if one is already set (e.g. CI's Postgres
// service container); otherwise auto-provisions a local embedded instance —
// this runs regardless of how vitest was invoked (npm script, IDE test
// runner, plain `vitest run`), since globalSetup always executes first.
export default async function setup() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = await ensureLocalDatabase("rfid_management_test");
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  // Explicit teardown instead of relying on the library's own exit-hook,
  // which otherwise leaves Node waiting on the child process's I/O for
  // several seconds after a graceful `vitest run` completes. No-ops if we
  // never started an instance in this process (real URL, or already-running
  // local instance reused from elsewhere).
  return async () => {
    await stopLocalDatabase();
  };
}
