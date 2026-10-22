const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./warehouseStock.controller");

const validation = require("./warehouseStock.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("warehouseStock.view"),
  validation.validateList,
  controller.listWarehouseStock,
);

router.get(
  "/product/:productCode",
  requirePermission("warehouseStock.view"),
  validation.validateProductParams,
  validation.validateProductQuery,
  controller.getProductWarehouseStock,
);

module.exports = router;
