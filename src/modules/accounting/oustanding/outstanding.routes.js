const express = require("express");
const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");
const {
  getCustomerOutstandingHandler,
  getSupplierOutstandingHandler,
} = require("./outstanding.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

// Relative paths — mounted at /api/accounting/outstanding
router.get(
  "/customers",
  requirePermission("ledger.view"),
  getCustomerOutstandingHandler,
);
router.get(
  "/suppliers",
  requirePermission("ledger.view"),
  getSupplierOutstandingHandler,
);

// Aliases
router.get(
  "/customer-outstanding",
  requirePermission("ledger.view"),
  getCustomerOutstandingHandler,
);
router.get(
  "/supplier-outstanding",
  requirePermission("ledger.view"),
  getSupplierOutstandingHandler,
);

module.exports = router;
