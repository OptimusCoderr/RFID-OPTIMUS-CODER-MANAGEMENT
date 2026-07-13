import { z } from "zod";

export const downloadAgentPackageBody = z.object({
  // Not re-validated against any encoder record — the caller already has
  // this value in hand (it was just shown to them at creation/rotation
  // time), this endpoint only packages it into a downloadable file.
  agentKey: z.string().min(1).max(200),
  serverUrl: z.string().url(),
});
