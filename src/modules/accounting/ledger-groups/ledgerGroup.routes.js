// const express = require("express");

// const verifyToken = require("../../../middleware/authMiddleware");
// const resolveTenant = require("../../../middleware/tenantMiddleware");
// const requirePlatformRole = require("../../../middleware/platformMiddleware");

// const {
//   getGroups,
//   seedGroups,
//   createGroup,
// } = require("./ledgerGroup.controller");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// router.get("/", getGroups);

// router.post(
//   "/seed",
//   requirePlatformRole("developer"),
//   seedGroups
// );

// router.post(
//   "/",
//   requirePlatformRole("developer"),
//   createGroup
// );

// module.exports = router;

const express = require("express");

const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require(
  "../../../middleware/permissionMiddleware",
);

const {
  getGroups,
  seedGroups,
  createGroup,
} = require("./ledgerGroup.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("ledgerGroup.view"),
  getGroups,
);

router.post(
  "/seed",
  requirePermission("ledgerGroup.create"),
  seedGroups,
);

router.post(
  "/",
  requirePermission("ledgerGroup.create"),
  createGroup,
);

module.exports = router;