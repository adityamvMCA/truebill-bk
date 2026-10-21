const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./purchaseReturn.controller");
const validation = require("./purchaseReturn.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("purchaseReturn.view"),
  validation.validateList,
  controller.listReturns,
);

router.post(
  "/",
  requirePermission("purchaseReturn.create"),
  requirePermission("purchaseReturn.post"),
  requirePermission("purchaseBill.view"),
  validation.validateCreate,
  controller.createReturn,
);

router.get(
  "/:returnNumber",
  requirePermission("purchaseReturn.view"),
  validation.validateParams,
  controller.getReturn,
);

module.exports = router;
