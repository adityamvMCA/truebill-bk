const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const {
  getPayables,
  getPayableParty,
  getReceivables,
  getReceivableParty,
} = require("../reports/receivablePayable.controller");

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
