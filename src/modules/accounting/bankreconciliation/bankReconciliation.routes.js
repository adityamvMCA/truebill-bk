const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./bankReconciliation.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/accounts",
  requirePermission("bankReconciliation.view"),
  controller.getBankAccounts,
);

router.get(
  "/history",
  requirePermission("bankReconciliation.view"),
  controller.getHistory,
);

router.get(
  "/",
  requirePermission("bankReconciliation.view"),
  controller.getBankReconciliation,
);

router.post(
  "/clear",
  requirePermission("bankReconciliation.reconcile"),
  controller.setCleared,
);

router.post(
  "/finalize",
  requirePermission("bankReconciliation.reconcile"),
  controller.finalizeReconciliation,
);

router.post(
  "/:reconciliationId/undo",
  requirePermission("bankReconciliation.reconcile"),
  controller.undoReconciliation,
);

module.exports = router;