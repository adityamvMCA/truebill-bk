const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./gstrReports.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/gstr1",
  requirePermission("gst.gstrReports"),
  controller.getGstr1,
);

router.get(
  "/gstr3b",
  requirePermission("gst.gstrReports"),
  controller.getGstr3b,
);

module.exports = router;