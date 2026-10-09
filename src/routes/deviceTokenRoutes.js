const express = require("express");
const {
  registerDeviceToken,
  getDeviceTokens,
  deactivateDeviceToken,
} = require("../controllers/deviceTokenController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", authMiddleware, registerDeviceToken);
router.get("/", authMiddleware, getDeviceTokens);
router.patch("/:id/deactivate", authMiddleware, deactivateDeviceToken);

module.exports = router;
