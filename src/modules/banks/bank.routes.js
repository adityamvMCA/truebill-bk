const express = require("express");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const c = require("./bank.controller");
const v = require("./bank.validation");

const router = express.Router();
router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("bank.view"),
  v.validateListBanks,
  c.getBanks,
);
router.post(
  "/",
  requirePermission("bank.create"),
  v.validateCreateBank,
  c.createBank,
);
router.get(
  "/:bankCode",
  requirePermission("bank.view"),
  v.validateBankParams,
  c.getBankByCode,
);
router.put(
  "/:bankCode",
  requirePermission("bank.update"),
  v.validateBankParams,
  v.validateUpdateBank,
  c.updateBank,
);

module.exports = router;
