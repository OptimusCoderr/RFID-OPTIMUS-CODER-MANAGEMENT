import { Router } from "express";
import * as agentPackageController from "../controllers/agentPackageController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { downloadAgentPackageBody } from "../validators/agentPackage";

const router = Router();

router.use(authenticate);

router.post("/download", validate({ body: downloadAgentPackageBody }), agentPackageController.downloadAgentPackage);

export default router;
