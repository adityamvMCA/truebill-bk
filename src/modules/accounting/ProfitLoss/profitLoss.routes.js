const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");

const controller = require("./profitLoss.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", requirePermission("profitLoss.view"), controller.getProfitLoss);

module.exports = router;
