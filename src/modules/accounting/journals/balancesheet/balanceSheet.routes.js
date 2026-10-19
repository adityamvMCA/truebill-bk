// src/modules/accounting/reports/balanceSheet.routes.js

const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware");
const resolveTenant = require("../../../../middleware/tenantMiddleware");
const requirePermission = require("../../../../middleware/permissionMiddleware");
const { getBalanceSheetHandler } = require("./balanceSheet.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/balance-sheet",
  requirePermission("ledger.view"),
  getBalanceSheetHandler
);

module.exports = router;
