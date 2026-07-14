// Runs an arbitrary command after making sure a DATABASE_URL is available —
// either the one already configured, or a freshly auto-provisioned local
// database (see src/devtools/localDb.ts). Used to wrap one-off CLI commands
// like `prisma migrate deploy` that don't go through src/index.ts's own
// bootstrap.
//
// Usage: tsx scripts/withLocalDb.ts -- <command> [args...]
import { spawn } from "child_process";
import { ensureDevEnvironment } from "../src/devtools/localDb.js";

async function main() {
  const separatorIndex = process.argv.indexOf("--");
  const command = separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(separatorIndex + 1);
  if (command.length === 0) {
    console.error("Usage: tsx scripts/withLocalDb.ts -- <command> [args...]");
    process.exit(1);
  }

  await ensureDevEnvironment();

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  child.on("exit", (code, signal) => {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

main().catch((err) => {
  console.error("[local-db] Failed to prepare the database:", err);
  process.exit(1);
});
