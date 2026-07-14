import { Router } from "express";
import * as notificationController from "../controllers/notificationController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParams } from "../validators/common.js";

const router = Router();
router.use(authenticate);

router.get("/", notificationController.listNotifications);
router.post("/:id/read", validate({ params: idParams }), notificationController.markRead);
router.post("/read-all", notificationController.markAllRead);

export default router;
