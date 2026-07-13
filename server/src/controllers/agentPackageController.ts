import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { asyncHandler } from "../utils/asyncHandler";

// Two directories up from the compiled dist/controllers/ (or src/controllers/
// under tsx) puts us at the server package root, alongside agent-dist/.
const AGENT_DIST_DIR = path.join(__dirname, "..", "..", "agent-dist");

// Streams a ready-to-run zip of the standalone agent package: the prebuilt
// JS, its own minimal package.json/README, and a .env pre-filled with the
// values the caller already has in hand (they were just shown the agentKey
// at creation/rotation time — this endpoint doesn't grant any new access,
// it just saves a copy/paste).
export const downloadAgentPackage = asyncHandler(async (req: Request, res: Response) => {
  const { agentKey, serverUrl } = req.body as { agentKey: string; serverUrl: string };

  const distDir = path.join(AGENT_DIST_DIR, "dist");
  if (!fs.existsSync(distDir)) {
    throw new Error(
      "The agent package hasn't been built on this server yet (agent-dist/dist is missing) — run `npm run build:agent` in server/."
    );
  }

  const zip = new AdmZip();
  zip.addLocalFile(path.join(AGENT_DIST_DIR, "package.json"));
  zip.addLocalFile(path.join(AGENT_DIST_DIR, "README.md"));
  zip.addLocalFolder(distDir, "dist");
  zip.addFile(".env", Buffer.from(`AGENT_SERVER_URL="${serverUrl}"\nAGENT_KEY="${agentKey}"\n`, "utf8"));

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="rfid-agent.zip"');
  res.send(zip.toBuffer());
});
