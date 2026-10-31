const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./productUnit.controller");
const validation = require("./productUnit.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("unit.view"),
  validation.validateList,
  controller.listUnits
);

router.post(
  "/",
  requirePermission("unit.create"),
  validation.validateCreate,
  controller.createUnit
);

router.post(
  "/bulk-status",
  requirePermission("unit.update"),
  validation.validateBulkStatus,
  controller.bulkUpdateStatus
);

router.post(
  "/import",
  requirePermission("unit.create"),
  controller.importUnits
);

router.get(
  "/:unitCode",
  requirePermission("unit.view"),
  validation.validateParams,
  controller.getUnit
);

router.patch(
  "/:unitCode",
  requirePermission("unit.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateUnit
);

module.exports = router;