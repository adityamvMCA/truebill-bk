const requirePermission = require("../../../middleware/permissionMiddleware");
const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePlatformRole = require("../../../middleware/platformMiddleware");
const { getLedgerInsights } = require("./ledgerInsights.controller");
const {
  getAllLedgers,
  seedLedgers,
  createLedger,
} = require("./ledger.controller");

const {
  getLedgerTransactions,
} = require("./ledgerTransaction.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", getAllLedgers);

router.post(
  "/seed",
  requirePlatformRole("developer"),
  seedLedgers,
);

router.post(
  "/",
  requirePlatformRole("developer"),
  createLedger,
);

router.get(
  "/:ledgerCode/transactions",
  getLedgerTransactions,
);
router.get(
  "/:ledgerCode/insights",
  requirePermission("ledger.view"),
  getLedgerInsights,
);
module.exports = router;