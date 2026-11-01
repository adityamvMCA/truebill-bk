// const express = require("express");

// const verifyToken = require("../../../middleware/authMiddleware");
// const resolveTenant = require("../../../middleware/tenantMiddleware");
// const requirePermission = require("../../../middleware/permissionMiddleware");

// const { createManualJournal } = require("./journal.controller");

// const { validateCreateManualJournal } = require("./journal.validation");
// const { getDayBookHandler } = require("./Daybbok/daybook.controller");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// router.post(
//   "/",
//   requirePermission("ledger.view"),
//   requirePermission("ledger.create"),
//   validateCreateManualJournal,
//   createManualJournal,
// );
// router.get("/daybook", requirePermission("ledger.view"), getDayBookHandler);
// module.exports = router;

const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const { createManualJournal } = require("./journal.controller");

const { validateCreateManualJournal } = require("./journal.validation");
const {
  getDayBookHandler,
  getDayBookListHandler,
  getDayBookSummaryHandler,
} = require("./Daybbok/daybook.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.post(
  "/",
  requirePermission("ledger.view"),
  requirePermission("ledger.create"),
  validateCreateManualJournal,
  createManualJournal,
);
router.get("/daybook", requirePermission("ledger.view"), getDayBookHandler);

// FAST (added)
router.get("/daybook/list", requirePermission("ledger.view"), getDayBookListHandler);
router.get("/daybook/summary", requirePermission("ledger.view"), getDayBookSummaryHandler);

module.exports = router;