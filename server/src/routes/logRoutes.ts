import { Router } from "express";
import * as logController from "../controllers/logController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);
router.get("/", logController.listLogs);
router.get("/export", logController.exportLogs);

export default router;
