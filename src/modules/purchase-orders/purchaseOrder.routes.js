const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./purchaseOrder.controller");
const validation = require("./purchaseOrder.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const requireDirectCreate = requirePermission("purchaseOrder.createDirect");

const requireQuotationView = requirePermission("supplierQuotation.view");

const requireCreationModePermission = (req, res, next) => {
  if (req.validatedBody.creationMode === "DIRECT") {
    return requireDirectCreate(req, res, next);
  }

  return requireQuotationView(req, res, next);
};

router.get(
  "/",
  requirePermission("purchaseOrder.view"),
  validation.validateList,
  controller.listOrders,
);

router.post(
  "/",
  requirePermission("purchaseOrder.create"),
  validation.validateCreate,
  requireCreationModePermission,
  controller.createOrder,
);

router.get(
  "/:orderNumber",
  requirePermission("purchaseOrder.view"),
  validation.validateParams,
  controller.getOrder,
);

router.patch(
  "/:orderNumber",
  requirePermission("purchaseOrder.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateOrder,
);

router.post(
  "/:orderNumber/cancel",
  requirePermission("purchaseOrder.cancel"),
  validation.validateParams,
  validation.validateCancel,
  controller.cancelOrder,
);

module.exports = router;
