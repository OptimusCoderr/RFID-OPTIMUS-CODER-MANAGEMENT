// Ensures the standalone downloadable agent package (server/agent-dist/)
// has been compiled before the "Download agent" endpoint tries to zip it up.
//
// agent-dist/dist/ is a build artifact (gitignored, like dist/) rather than
// something committed to the repo, so it needs to exist on disk before it
// can be served. `npm run dev`/`build`/`test` already regenerate it via
// pre-hooks in package.json, and the Docker image builds it explicitly —
// but VS Code's "Server: Debug (tsx)" launch config runs tsx directly,
// bypassing those npm hooks. This is the fallback for that path (and any
// other way the server might get started that isn't through npm scripts).
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const SERVER_ROOT = path.join(__dirname, "..", "..");
const AGENT_DIST_MARKER = path.join(SERVER_ROOT, "agent-dist", "dist", "agent", "agent.js");

export function ensureAgentDistBuilt(): void {
  if (fs.existsSync(AGENT_DIST_MARKER)) return;

  console.log("[agent-dist] Building the standalone agent package (first run)...");
  execSync("npx tsc -p tsconfig.agent.json", { cwd: SERVER_ROOT, stdio: "inherit" });
}
