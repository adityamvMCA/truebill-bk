const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const {
  getCustomerOutstanding,
  getSupplierOutstanding,
} = require("./outstanding.controller");

const { validateOutstandingQuery } = require("./outstanding.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/customers",
  requirePermission("customerOutstanding.view"),
  validateOutstandingQuery,
  getCustomerOutstanding,
);

router.get(
  "/suppliers",
  requirePermission("supplierOutstanding.view"),
  validateOutstandingQuery,
  getSupplierOutstanding,
);

module.exports = router;
