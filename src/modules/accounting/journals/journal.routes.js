const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require(
  "../../../middleware/permissionMiddleware",
);

const {
  createManualJournal,
} = require("./journal.controller");

const {
  validateCreateManualJournal,
} = require("./journal.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.post(
  "/",
  requirePermission("ledger.view"),
  requirePermission("ledger.create"),
  validateCreateManualJournal,
  createManualJournal,
);

module.exports = router;