const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./goodsReceipt.controller");
const validation = require("./goodsReceipt.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const requireDirectCreate = requirePermission("goodsReceipt.createDirect");

const requireOrderView = requirePermission("purchaseOrder.view");

const requireModePermission = (req, res, next) => {
  if (req.validatedBody.creationMode === "DIRECT") {
    return requireDirectCreate(req, res, next);
  }

  return requireOrderView(req, res, next);
};

router.get(
  "/",
  requirePermission("goodsReceipt.view"),
  validation.validateList,
  controller.listReceipts,
);

router.post(
  "/",
  requirePermission("goodsReceipt.create"),
  validation.validateCreate,
  requireModePermission,
  controller.createReceipt,
);

router.get(
  "/:receiptNumber",
  requirePermission("goodsReceipt.view"),
  validation.validateParams,
  controller.getReceipt,
);

module.exports = router;
