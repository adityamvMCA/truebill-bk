// // src/modules/accounting/journals/daybook.routes.js

// const express = require("express");
// const verifyToken = require("../../../../middleware/authMiddleware");
// const resolveTenant = require("../../../../middleware/tenantMiddleware");
// const requirePermission = require("../../../../middleware/permissionMiddleware");
// const { getDayBookHandler } = require("./daybook.controller");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// // Read permission — same as ledger.view for now
// router.get(
//   "/daybook",
//   requirePermission("ledger.view"),
//   getDayBookHandler
// );

// module.exports = router;
// src/modules/accounting/journals/daybook.routes.js

const express = require("express");
const verifyToken = require("../../../../middleware/authMiddleware");
const resolveTenant = require("../../../../middleware/tenantMiddleware");
const requirePermission = require("../../../../middleware/permissionMiddleware");
const {
  getDayBookHandler,
  getDayBookListHandler,
  getDayBookSummaryHandler,
} = require("./daybook.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

// Read permission — same as ledger.view for now
router.get(
  "/daybook",
  requirePermission("ledger.view"),
  getDayBookHandler
);

// FAST (added)
router.get(
  "/daybook/list",
  requirePermission("ledger.view"),
  getDayBookListHandler
);
router.get(
  "/daybook/summary",
  requirePermission("ledger.view"),
  getDayBookSummaryHandler
);

module.exports = router;