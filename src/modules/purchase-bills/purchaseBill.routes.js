const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");

const requirePermission = require("../../middleware/permissionMiddleware");

const {
  createPurchaseBill,
  getPurchaseBills,
  getPurchaseBillByNumber,
  updatePurchaseBill,
  postPurchaseBill,
  deletePurchaseBill,
  getPurchaseBillPayments,
} = require("./purchaseBill.controller");

const {
  validateCreatePurchaseBill,
  validateUpdatePurchaseBill,
  validatePostPurchaseBill,
  validatePurchaseBillParams,
  validateListPurchaseBills,
  validatePurchaseBillPaymentsQuery,
} = require("./purchaseBill.validation");

/* ---- AI bill scanning ---- */
const { scanBill, confirmScan } = require("./billScan.controller");
const { uploadBillFiles } = require("./billScan.upload");
const { validateConfirmScan } = require("./billScan.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const runIf = (predicate, middleware) => (req, res, next) =>
  predicate(req) ? middleware(req, res, next) : next();

router.get(
  "/",
  requirePermission("purchaseBill.view"),
  validateListPurchaseBills,
  getPurchaseBills,
);

router.post(
  "/",
  requirePermission("purchaseBill.create"),
  requirePermission("purchaseBill.post"),
  validateCreatePurchaseBill,
  createPurchaseBill,
);

/* Scan a bill (read-only: nothing is saved) */
router.post(
  "/scan",
  requirePermission("purchaseBill.create"),
  uploadBillFiles,
  scanBill,
);

/* Confirm reviewed scan: creates missing supplier/products, then posts the bill */
router.post(
  "/scan/confirm",
  requirePermission("purchaseBill.create"),
  requirePermission("purchaseBill.post"),
  validateConfirmScan,
  runIf((req) => req.body.supplier.mode === "NEW", requirePermission("supplier.create")),
  runIf(
    (req) => req.body.items.some((item) => item.product.mode === "NEW"),
    requirePermission("product.create"),
  ),
  confirmScan,
);

router.get(
  "/number/:billNumber",
  requirePermission("purchaseBill.view"),
  validatePurchaseBillParams,
  getPurchaseBillByNumber,
);

router.put(
  "/number/:billNumber",
  requirePermission("purchaseBill.update"),
  validatePurchaseBillParams,
  validateUpdatePurchaseBill,
  updatePurchaseBill,
);

router.post(
  "/number/:billNumber/post",
  requirePermission("purchaseBill.post"),
  validatePurchaseBillParams,
  validatePostPurchaseBill,
  postPurchaseBill,
);

router.delete(
  "/number/:billNumber",
  requirePermission("purchaseBill.delete"),
  validatePurchaseBillParams,
  deletePurchaseBill,
);

router.get(
  "/number/:billNumber/payments",
  requirePermission("purchaseBill.view"),
  requirePermission("supplierPayment.view"),
  validatePurchaseBillParams,
  validatePurchaseBillPaymentsQuery,
  getPurchaseBillPayments,
);

module.exports = router;
