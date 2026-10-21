const express = require("express");

const verifyToken = require(
  "../../middleware/authMiddleware",
);

const resolveTenant = require(
  "../../middleware/tenantMiddleware",
);

const requirePermission = require(
  "../../middleware/permissionMiddleware",
);

const controller = require("./purchaseRfq.controller");
const validation = require("./purchaseRfq.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

/* ==========================================
   MODE-SPECIFIC CREATE PERMISSION
   ========================================== */

const requireDirectCreate = requirePermission(
  "purchaseRfq.createDirect",
);

const requireRequisitionView = requirePermission(
  "purchaseRequisition.view",
);

const requireCreationModePermission = (
  req,
  res,
  next,
) => {
  if (req.validatedBody.creationMode === "DIRECT") {
    return requireDirectCreate(req, res, next);
  }

  return requireRequisitionView(req, res, next);
};

/* ==========================================
   ROUTES
   ========================================== */

router.get(
  "/",
  requirePermission("purchaseRfq.view"),
  validation.validateList,
  controller.listRfqs,
);

router.post(
  "/",
  requirePermission("purchaseRfq.create"),
  validation.validateCreate,
  requireCreationModePermission,
  controller.createRfq,
);

router.get(
  "/:rfqNumber",
  requirePermission("purchaseRfq.view"),
  validation.validateParams,
  controller.getRfq,
);

router.patch(
  "/:rfqNumber",
  requirePermission("purchaseRfq.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateRfq,
);

router.post(
  "/:rfqNumber/issue",
  requirePermission("purchaseRfq.issue"),
  validation.validateParams,
  validation.validateVersion,
  controller.issueRfq,
);

router.post(
  "/:rfqNumber/close",
  requirePermission("purchaseRfq.close"),
  validation.validateParams,
  validation.validateVersion,
  controller.closeRfq,
);

router.post(
  "/:rfqNumber/cancel",
  requirePermission("purchaseRfq.cancel"),
  validation.validateParams,
  validation.validateCancel,
  controller.cancelRfq,
);

router.delete(
  "/:rfqNumber",
  requirePermission("purchaseRfq.delete"),
  validation.validateParams,
  validation.validateVersion,
  controller.deleteRfq,
);

module.exports = router;