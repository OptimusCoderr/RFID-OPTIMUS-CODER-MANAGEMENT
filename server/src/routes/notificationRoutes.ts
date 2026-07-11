import { Router } from "express";
import * as notificationController from "../controllers/notificationController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParams } from "../validators/common";

const router = Router();
router.use(authenticate);

router.get("/", notificationController.listNotifications);
router.post("/:id/read", validate({ params: idParams }), notificationController.markRead);
router.post("/read-all", notificationController.markAllRead);

export default router;
