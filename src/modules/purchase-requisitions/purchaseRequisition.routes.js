const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./purchaseRequisition.controller");
const validation = require("./purchaseRequisition.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("purchaseRequisition.view"),
  validation.validateList,
  controller.listRequisitions,
);

router.post(
  "/",
  requirePermission("purchaseRequisition.create"),
  validation.validateCreate,
  controller.createRequisition,
);

router.get(
  "/:requisitionNumber",
  requirePermission("purchaseRequisition.view"),
  validation.validateParams,
  controller.getRequisition,
);

router.patch(
  "/:requisitionNumber",
  requirePermission("purchaseRequisition.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateRequisition,
);

router.post(
  "/:requisitionNumber/approve",
  requirePermission("purchaseRequisition.approve"),
  validation.validateParams,
  validation.validateVersion,
  controller.approveRequisition,
);

router.post(
  "/:requisitionNumber/reject",
  requirePermission("purchaseRequisition.reject"),
  validation.validateParams,
  validation.validateReject,
  controller.rejectRequisition,
);

router.post(
  "/:requisitionNumber/cancel",
  requirePermission("purchaseRequisition.cancel"),
  validation.validateParams,
  validation.validateCancel,
  controller.cancelRequisition,
);

router.delete(
  "/:requisitionNumber",
  requirePermission("purchaseRequisition.delete"),
  validation.validateParams,
  validation.validateVersion,
  controller.deleteRequisition,
);

module.exports = router;
