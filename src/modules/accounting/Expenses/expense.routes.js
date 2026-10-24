const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const { requireTenantAdmin } = require("./expense.access");

const {
  getOptions,
  createExpense,
  getExpenses,
  getExpenseByNumber,
  approveExpense,
  rejectExpense,
  cancelExpense,
} = require("./expense.controller");

const {
  validateCreateExpense,
  validateExpenseParams,
  validateRejectExpense,
  validateListExpenses,
} = require("./expense.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/options",
  requirePermission("expense.create"),
  requirePermission("ledger.view"),
  getOptions,
);

router.get(
  "/",
  requirePermission("expense.view"),
  validateListExpenses,
  getExpenses,
);

router.get(
  "/number/:expenseNumber",
  requirePermission("expense.view"),
  validateExpenseParams,
  getExpenseByNumber,
);

router.post(
  "/",
  requirePermission("expense.create"),
  validateCreateExpense,
  createExpense,
);

// Admin only: approve posts the accounting entry.
router.post(
  "/number/:expenseNumber/approve",
  requireTenantAdmin,
  requirePermission("expense.approve"),
  validateExpenseParams,
  approveExpense,
);

router.post(
  "/number/:expenseNumber/reject",
  requireTenantAdmin,
  requirePermission("expense.approve"),
  validateRejectExpense,
  rejectExpense,
);

router.post(
  "/number/:expenseNumber/cancel",
  requirePermission("expense.cancel"),
  validateExpenseParams,
  cancelExpense,
);

module.exports = router;

// app.use("/api/expenses", require("./modules/expenses/expense.routes"));
