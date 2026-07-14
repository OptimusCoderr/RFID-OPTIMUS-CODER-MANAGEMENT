import { Router } from "express";
import * as agentPackageController from "../controllers/agentPackageController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { downloadAgentPackageBody } from "../validators/agentPackage.js";

const router = Router();

router.use(authenticate);

router.post("/download", validate({ body: downloadAgentPackageBody }), agentPackageController.downloadAgentPackage);

export default router;
