const express = require("express");

const {
  getPreferences,
  updatePreferences,
  resetPreferences,
} = require("../controllers/notificationPreferenceController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authMiddleware, getPreferences);
router.patch("/", authMiddleware, updatePreferences);
router.patch("/reset", authMiddleware, resetPreferences);

module.exports = router;
