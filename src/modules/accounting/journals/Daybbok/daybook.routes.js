// src/modules/accounting/journals/daybook.routes.js

const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware");
const resolveTenant = require("../../../../middleware/tenantMiddleware");
const requirePermission = require("../../../../middleware/permissionMiddleware");
const { getDayBookHandler } = require("./daybook.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

// Read permission — same as ledger.view for now
router.get(
  "/daybook",
  requirePermission("ledger.view"),
  getDayBookHandler
);

module.exports = router;
