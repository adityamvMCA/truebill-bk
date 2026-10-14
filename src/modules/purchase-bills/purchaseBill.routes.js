const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");

const requirePermission = require(
  "../../middleware/permissionMiddleware",
);

const {
  createPurchaseBill,
  getPurchaseBills,
  getPurchaseBillByNumber,
  updatePurchaseBill,
  postPurchaseBill,
  deletePurchaseBill,
} = require("./purchaseBill.controller");

const {
  validateCreatePurchaseBill,
  validateUpdatePurchaseBill,
  validatePostPurchaseBill,
  validatePurchaseBillParams,
  validateListPurchaseBills,
} = require("./purchaseBill.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const checkPostPermission = requirePermission("purchaseBill.post");

const requirePostPermissionForCreate = (req, res, next) => {
  if (req.body.action === "SAVE_AND_POST") {
    return checkPostPermission(req, res, next);
  }

  return next();
};

router.get(
  "/",
  requirePermission("purchaseBill.view"),
  validateListPurchaseBills,
  getPurchaseBills,
);

router.post(
  "/",
  requirePermission("purchaseBill.create"),
  validateCreatePurchaseBill,
  requirePostPermissionForCreate,
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

module.exports = router;