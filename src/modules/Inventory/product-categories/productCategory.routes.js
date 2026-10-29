const express = require("express");
const multer = require("multer");
const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");
const controller = require("./productCategory.controller");
const validation = require("./productCategory.validation");
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
}).single("file");
const csvUpload = (req, res, next) =>
  upload(req, res, (error) => {
    if (error)
      return res.status(400).json({ success: false, message: error.message });
    return next();
  });
router.use(verifyToken, resolveTenant);
router.post(
  "/seed-defaults",
  requirePermission("category.create"),
  requirePermission("category.update"),
  validation.validateSeed,
  controller.seedDefaults,
);
router.post(
  "/import",
  requirePermission("category.create"),
  csvUpload,
  controller.importCategories,
);
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
  "/bulk-status",
  requirePermission("category.update"),
  controller.bulkUpdateStatus,
);
module.exports = router;
