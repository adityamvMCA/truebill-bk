const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

// Old endpoints, kept so any other page that still uses them keeps working.
const {
  getPayables,
  getPayableParty,
  getReceivables,
  getReceivableParty,
} = require("../reports/receivablePayable.controller");

const {
  getCustomerOutstanding,
  getSupplierOutstanding,
  getCustomerOutstandingSummary,
  getSupplierOutstandingSummary,
} = require("./outstanding.controller");

const { validateOutstandingQuery } = require("./outstanding.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

/* ---------- new: server-side paged + bucketed ---------- */
router.get(
  "/customers",
  requirePermission("customerOutstanding.view"),
  validateOutstandingQuery,
  getCustomerOutstanding,
);
router.get(
  "/customers/summary",
  requirePermission("customerOutstanding.view"),
  validateOutstandingQuery,
  getCustomerOutstandingSummary,
);

router.get(
  "/suppliers",
  requirePermission("supplierOutstanding.view"),
  validateOutstandingQuery,
  getSupplierOutstanding,
);
router.get(
  "/suppliers/summary",
  requirePermission("supplierOutstanding.view"),
  validateOutstandingQuery,
  getSupplierOutstandingSummary,
);

/* ---------- old (unchanged) ---------- */
router.get("/payables", requirePermission("ledger.view"), getPayables);
router.get("/payables/:partyId", requirePermission("ledger.view"), getPayableParty);

router.get("/receivables", requirePermission("ledger.view"), getReceivables);
router.get("/receivables/:partyId", requirePermission("ledger.view"), getReceivableParty);

module.exports = router;