const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePlatformRole = require("../../../middleware/platformMiddleware");

const {
  getAllLedgers,
  seedLedgers,
  createLedger,
} = require("./ledger.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", getAllLedgers);

router.post(
  "/seed",
  requirePlatformRole("developer"),
  seedLedgers
);

router.post(
  "/",
  requirePlatformRole("developer"),
  createLedger
);

module.exports = router;