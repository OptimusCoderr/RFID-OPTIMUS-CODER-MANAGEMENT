import { Router } from "express";
import * as dashboardController from "../controllers/dashboardController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);
router.get("/stats", dashboardController.getStats);

export default router;
