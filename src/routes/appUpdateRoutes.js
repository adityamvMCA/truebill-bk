const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const requirePlatformRole = require("../middleware/platformMiddleware");
const {
  notifyAndroidAppUpdate,
} = require("../controllers/appUpdateController");
const requireInternalNotificationSecret = require("../middleware/internalNotificationMiddleware");

const router = express.Router();

// router.post(
//   "/notify",
//   verifyToken,
//   requirePlatformRole("developer"),
//   notifyAndroidAppUpdate
// );

router.post(
  "/notify",
  requireInternalNotificationSecret,
  notifyAndroidAppUpdate,
);

module.exports = router;