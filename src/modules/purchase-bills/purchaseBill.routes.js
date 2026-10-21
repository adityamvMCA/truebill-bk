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

const router = express.Router();

router.use(verifyToken, resolveTenant);


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
