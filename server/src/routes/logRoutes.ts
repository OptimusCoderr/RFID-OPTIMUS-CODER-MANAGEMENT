import { Router } from "express";
import * as logController from "../controllers/logController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);
router.get("/", logController.listLogs);
router.get("/export", logController.exportLogs);

export default router;
