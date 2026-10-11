const express = require("express");

const {
  getNotifications,
  getUnreadCount,
  createTestNotification,
  markAsRead,
  markAllAsRead,
  createTypedTestNotification,
} = require("../controllers/notificationController");

const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", getNotifications);

router.get("/unread-count", getUnreadCount);

router.post("/test", createTestNotification);

router.patch("/:id/read", markAsRead);

router.patch("/read-all", markAllAsRead);

router.post("/test-typed", createTypedTestNotification);

module.exports = router;
