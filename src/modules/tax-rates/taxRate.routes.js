const express = require("express");
const multer = require("multer");

const verifyToken = require("../../middleware/authMiddleware");

const resolveTenant = require("../../middleware/tenantMiddleware");

const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./taxRate.controller");

const validation = require("./taxRate.validation");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("tax.view"),
  validation.validateList,
  controller.listTaxRates,
);

router.post(
  "/",
  requirePermission("tax.create"),
  validation.validateCreate,
  controller.createTaxRate,
);

router.post(
  "/import",
  requirePermission("tax.create"),
  upload.single("file"),
  controller.importRates,
);

router.get(
  "/:taxRateId",
  requirePermission("tax.view"),
  validation.validateParams,
  controller.getTaxRate,
);

router.patch(
  "/:taxRateId",
  requirePermission("tax.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateTaxRate,
);

module.exports = router;
