const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./gstSummary.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", requirePermission("gstSummary.view"), controller.getGstSummary);

module.exports = router;
