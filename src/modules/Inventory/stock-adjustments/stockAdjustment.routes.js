const express = require("express");

const {
  createStockAdjustment,
  listStockAdjustments,
  getStockAdjustment,
} = require("./stockAdjustment.controller");

const {
  validateCreate,
  validateList,
} = require("./stockAdjustment.validation");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("stock.adjustment.view"),
  validateList,
  listStockAdjustments,
);

router.post(
  "/",
  requirePermission("stock.adjustment.create"),
  validateCreate,
  createStockAdjustment,
);

router.get(
  "/:adjustmentNumber",
  requirePermission("stock.adjustment.view"),
  getStockAdjustment,
);

module.exports = router;
