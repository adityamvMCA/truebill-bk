const express = require("express");
const {
  getNotifications,
  getUnreadCount,
  createTestNotification,
  markAsRead,
  markAllAsRead,
  createTypedTestNotification,
} = require("../controllers/notificationController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authMiddleware, getNotifications);
router.get("/unread-count", authMiddleware, getUnreadCount);
router.post("/test", authMiddleware, createTestNotification);
router.patch("/:id/read", authMiddleware, markAsRead);
router.patch("/read-all", authMiddleware, markAllAsRead);
router.post("/test-typed", authMiddleware, createTypedTestNotification);
module.exports = router;
