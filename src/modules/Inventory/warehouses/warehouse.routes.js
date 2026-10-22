const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./warehouse.controller");

const validation = require("./warehouse.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/settings",
  requirePermission("warehouse.view"),
  controller.getInventorySettings,
);

router.get(
  "/",
  requirePermission("warehouse.view"),
  validation.validateList,
  controller.listWarehouses,
);

router.post(
  "/",
  requirePermission("warehouse.create"),
  validation.validateCreate,
  controller.createWarehouse,
);

router.get(
  "/:warehouseCode",
  requirePermission("warehouse.view"),
  validation.validateParams,
  controller.getWarehouse,
);

router.patch(
  "/:warehouseCode",
  requirePermission("warehouse.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateWarehouse,
);

module.exports = router;
