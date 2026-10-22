const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./productCategory.controller");

const validation = require("./productCategory.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("category.view"),
  validation.validateList,
  controller.listCategories,
);

router.post(
  "/",
  requirePermission("category.create"),
  validation.validateCreate,
  controller.createCategory,
);

router.get(
  "/:categoryCode",
  requirePermission("category.view"),
  validation.validateParams,
  controller.getCategory,
);

router.patch(
  "/:categoryCode",
  requirePermission("category.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateCategory,
);
router.post(
  "/import",
  requirePermission("category.create"),
  controller.importCategories,
);
module.exports = router;
