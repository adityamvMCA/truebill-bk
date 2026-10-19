
const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePlatformRole = require("../../../middleware/platformMiddleware");

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

module.exports = router;