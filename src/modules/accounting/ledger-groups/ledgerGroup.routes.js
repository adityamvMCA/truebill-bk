const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePlatformRole = require("../../../middleware/platformMiddleware");

const {
  getGroups,
  seedGroups,
  createGroup,
} = require("./ledgerGroup.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", getGroups);

router.post(
  "/seed",
  requirePlatformRole("developer"),
  seedGroups
);

router.post(
  "/",
  requirePlatformRole("developer"),
  createGroup
);

module.exports = router;