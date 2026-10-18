const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./taxConfiguration.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("taxConfiguration.view"),
  controller.getTaxConfiguration,
);

router.put(
  "/",
  requirePermission("taxConfiguration.update"),
  controller.saveTaxConfiguration,
);

module.exports = router;
