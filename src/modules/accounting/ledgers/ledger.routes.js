const express = require("express");
const verifyToken = require("../../../middleware/authMiddleware");
const requirePlatformRole = require("../../../middleware/platformMiddleware");
const {
  getAllLedgers,
  seedLedgers,
  createLedger,
} = require("./ledger.controller");

const router = express.Router();

router.get("/", verifyToken, getAllLedgers);

router.post(
  "/seed",
  verifyToken,
  requirePlatformRole("developer"),
  seedLedgers
);

router.post(
  "/",
  verifyToken,
  requirePlatformRole("developer"),
  createLedger
);

module.exports = router;