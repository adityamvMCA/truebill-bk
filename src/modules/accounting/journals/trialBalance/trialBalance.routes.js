// src/modules/accounting/reports/trialBalance.routes.js

const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware");
const resolveTenant = require("../../../../middleware/tenantMiddleware");
const requirePermission = require("../../../../middleware/permissionMiddleware");
const { getTrialBalanceHandler } = require("./trialBalance.controller");
const { getBalanceSheetHandler } = require("../balancesheet/balanceSheet.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/trial-balance",
  requirePermission("ledger.view"),
  getTrialBalanceHandler
);
router.get(
  "/balance-sheet",
  requirePermission("ledger.view"),
  getBalanceSheetHandler
);

module.exports = router;
