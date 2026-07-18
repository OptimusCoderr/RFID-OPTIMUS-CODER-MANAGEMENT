import { Router } from "express";
import * as cardController from "../controllers/cardController.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { validate } from "../middleware/validate.js";
import {
  registerCardBody,
  updateCardBody,
  assignCardBody,
  cardListQuery,
  cardEncodersBody,
  prepareCitizenWriteBody,
  decodeCitizenReadBody,
  bulkImportCardsBody,
} from "../validators/card.js";
import { idParams } from "../validators/common.js";

const router = Router();

router.use(authenticate);

const OPERATOR_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR"] as const;
const MANAGER_UP = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] as const;

router.get("/", validate({ query: cardListQuery }), cardController.listCards);
router.get("/export", validate({ query: cardListQuery }), cardController.exportCards);
router.get("/:id", validate({ params: idParams }), cardController.getCard);
router.get("/:id/keys", requireRole(...MANAGER_UP), validate({ params: idParams }), cardController.getCardKeys);
router.post(
  "/:id/keys/generate",
  requireRole(...MANAGER_UP),
  validate({ params: idParams }),
  cardController.generateCardKeys
);
router.post(
  "/:id/citizen-data/prepare-write",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: prepareCitizenWriteBody }),
  cardController.prepareCitizenWrite
);
router.post(
  "/:id/citizen-data/decode-read",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: decodeCitizenReadBody }),
  cardController.decodeCitizenRead
);

router.post("/", requireRole(...OPERATOR_UP), validate({ body: registerCardBody }), cardController.registerCard);
router.post(
  "/bulk-import",
  requireRole(...OPERATOR_UP),
  validate({ body: bulkImportCardsBody }),
  cardController.bulkImportCards
);
router.patch(
  "/:id",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: updateCardBody }),
  cardController.updateCard
);

router.post(
  "/:id/assign",
  requireRole(...OPERATOR_UP),
  validate({ params: idParams, body: assignCardBody }),
  cardController.assignCard
);
router.post("/:id/unassign", requireRole(...OPERATOR_UP), validate({ params: idParams }), cardController.unassignCard);
router.post("/:id/block", requireRole(...MANAGER_UP), validate({ params: idParams }), cardController.blockCard);
router.post("/:id/unblock", requireRole(...MANAGER_UP), validate({ params: idParams }), cardController.unblockCard);
router.post("/:id/lost", requireRole(...OPERATOR_UP), validate({ params: idParams }), cardController.markLostCard);
router.post("/:id/retire", requireRole(...MANAGER_UP), validate({ params: idParams }), cardController.retireCard);

router.post(
  "/:id/encoders/grant",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: cardEncodersBody }),
  cardController.grantCardEncoders
);
router.post(
  "/:id/encoders/revoke",
  requireRole(...MANAGER_UP),
  validate({ params: idParams, body: cardEncodersBody }),
  cardController.revokeCardEncoders
);

router.delete("/:id", requireRole(...MANAGER_UP), validate({ params: idParams }), cardController.deleteCard);

export default router;
