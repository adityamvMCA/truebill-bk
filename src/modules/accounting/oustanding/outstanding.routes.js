const express = require("express");
const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");
const {
  getCustomerOutstandingHandler,
  getSupplierOutstandingHandler,
} = require("./outstanding.controller");
const {
  getPayables,
  getPayableParty,
  getReceivables,
  getReceivableParty,
} = require("../../reports/receivablePayable.controller");

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

router.get("/payables", requirePermission("ledger.view"), getPayables);
router.get(
  "/payables/:partyId",
  requirePermission("ledger.view"),
  getPayableParty,
);

router.get("/receivables", requirePermission("ledger.view"), getReceivables);
router.get(
  "/receivables/:partyId",
  requirePermission("ledger.view"),
  getReceivableParty,
);
module.exports = router;
