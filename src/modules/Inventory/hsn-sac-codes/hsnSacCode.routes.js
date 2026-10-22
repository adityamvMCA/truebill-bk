const express = require("express");
const multer = require("multer");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./hsnSacCode.controller");

const validation = require("./hsnSacCode.validation");

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
  requirePermission("hsn.view"),
  validation.validateList,
  controller.listHsnSacCodes,
);

router.post(
  "/",
  requirePermission("hsn.create"),
  validation.validateCreate,
  controller.createHsnSacCode,
);

router.post(
  "/import",
  requirePermission("hsn.create"),
  upload.single("file"),
  controller.importCodes,
);

router.get(
  "/:code",
  requirePermission("hsn.view"),
  validation.validateParams,
  controller.getHsnSacCode,
);

router.patch(
  "/:code",
  requirePermission("hsn.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateHsnSacCode,
);

module.exports = router;
