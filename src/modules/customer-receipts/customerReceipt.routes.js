const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const {
  createCustomerReceipt,
  getCustomerReceipts,
  getCustomerReceiptByNumber,
  getUnpaidSalesInvoices,
  getReceiptLedgers,
} = require("./customerReceipt.controller");

const {
  validateCreateCustomerReceipt,
  validateCustomerReceiptParams,
  validateListCustomerReceipts,
} = require("./customerReceipt.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("customerReceipt.view"),
  validateListCustomerReceipts,
  getCustomerReceipts,
);

router.get(
  "/receipt-ledgers",
  requirePermission("customerReceipt.create"),
  requirePermission("ledger.view"),
  getReceiptLedgers,
);

router.get(
  "/unpaid-invoices",
  requirePermission("customerReceipt.create"),
  requirePermission("salesInvoice.view"),
  validateListCustomerReceipts,
  getUnpaidSalesInvoices,
);

router.get(
  "/number/:receiptNumber",
  requirePermission("customerReceipt.view"),
  validateCustomerReceiptParams,
  getCustomerReceiptByNumber,
);

router.post(
  "/",
  requirePermission("customerReceipt.create"),
  requirePermission("customerReceipt.post"),
  validateCreateCustomerReceipt,
  createCustomerReceipt,
);

module.exports = router;
