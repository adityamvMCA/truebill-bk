const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./productBrand.controller");

const validation = require("./productBrand.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("brand.view"),
  validation.validateList,
  controller.listBrands,
);

router.post(
  "/",
  requirePermission("brand.create"),
  validation.validateCreate,
  controller.createBrand,
);

router.get(
  "/:brandId",
  requirePermission("brand.view"),
  validation.validateParams,
  controller.getBrand,
);

router.patch(
  "/:brandId",
  requirePermission("brand.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateBrand,
);
router.post(
  "/import",
  requirePermission("brand.create"),
  controller.importBrands,
);
module.exports = router;
