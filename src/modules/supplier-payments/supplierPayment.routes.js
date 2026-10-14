const express = require("express");

const verifyToken = require(
  "../../middleware/authMiddleware",
);

const resolveTenant = require(
  "../../middleware/tenantMiddleware",
);

const requirePermission = require(
  "../../middleware/permissionMiddleware",
);

const {
  createSupplierPayment,
  getSupplierPayments,
  getSupplierPaymentByNumber,
  getUnpaidSupplierBills,
  getPaymentLedgers,
} = require("./supplierPayment.controller");

const {
  validateCreateSupplierPayment,
  validateSupplierPaymentParams,
  validateListSupplierPayments,
  validateUnpaidSupplierBills,
} = require("./supplierPayment.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("supplierPayment.view"),
  validateListSupplierPayments,
  getSupplierPayments,
);

router.get(
  "/payment-ledgers",
  requirePermission("supplierPayment.create"),
  requirePermission("ledger.view"),
  getPaymentLedgers,
);

router.get(
  "/unpaid-bills",
  requirePermission("supplierPayment.create"),
  requirePermission("purchaseBill.view"),
  validateUnpaidSupplierBills,
  getUnpaidSupplierBills,
);

router.get(
  "/number/:paymentNumber",
  requirePermission("supplierPayment.view"),
  validateSupplierPaymentParams,
  getSupplierPaymentByNumber,
);

router.post(
  "/",
  requirePermission("supplierPayment.create"),
  requirePermission("supplierPayment.post"),
  validateCreateSupplierPayment,
  createSupplierPayment,
);

module.exports = router;