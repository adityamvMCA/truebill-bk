const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./productBrand.controller");
const validation = require("./productBrand.validation");

const router = express.Router();

const assertHandler = (handler, label) => {
  if (typeof handler !== "function") {
    throw new TypeError(
      `Product Brand route configuration error: ${label} must be a function. Check its module.exports.`,
    );
  }

  return handler;
};

router.use(
  assertHandler(verifyToken, "verifyToken"),
  assertHandler(resolveTenant, "resolveTenant"),
);

router.post(
  "/seed-defaults",
  requirePermission("brand.create"),
  requirePermission("brand.update"),
  assertHandler(validation.validateSeed, "validation.validateSeed"),
  assertHandler(controller.seedDefaults, "controller.seedDefaults"),
);

router.post(
  "/import",
  requirePermission("brand.create"),
  assertHandler(controller.importBrands, "controller.importBrands"),
);

router.get(
  "/",
  requirePermission("brand.view"),
  assertHandler(validation.validateList, "validation.validateList"),
  assertHandler(controller.listBrands, "controller.listBrands"),
);

router.post(
  "/",
  requirePermission("brand.create"),
  assertHandler(validation.validateCreate, "validation.validateCreate"),
  assertHandler(controller.createBrand, "controller.createBrand"),
);

router.post(
  "/bulk-status",
  requirePermission("brand.update"),
  assertHandler(
    validation.validateBulkStatus,
    "validation.validateBulkStatus",
  ),
  assertHandler(controller.bulkUpdateStatus, "controller.bulkUpdateStatus"),
);

router.get(
  "/:brandId",
  requirePermission("brand.view"),
  assertHandler(validation.validateParams, "validation.validateParams"),
  assertHandler(controller.getBrand, "controller.getBrand"),
);

router.patch(
  "/:brandId",
  requirePermission("brand.update"),
  assertHandler(validation.validateParams, "validation.validateParams"),
  assertHandler(validation.validateUpdate, "validation.validateUpdate"),
  assertHandler(controller.updateBrand, "controller.updateBrand"),
);

module.exports = router;