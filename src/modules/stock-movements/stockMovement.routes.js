const express = require("express");

const {
  getStockMovements,
  createManualAdjustment,
  backfillOpeningStock,
} = require("./stockMovement.controller");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("product.view"),
  getStockMovements
);

router.post(
  "/product/:productCode/opening-backfill",
  requirePermission("product.update"),
  backfillOpeningStock
);

router.post(
  "/product/:productCode/adjustment",
  requirePermission("product.update"),
  createManualAdjustment
);

module.exports = router;