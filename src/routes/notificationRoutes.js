// const express = require("express");

// const {
//   getNotifications,
//   getUnreadCount,
//   createTestNotification,
//   markAsRead,
//   markAllAsRead,
//   createTypedTestNotification,
// } = require("../controllers/notificationController");

// const verifyToken = require("../middleware/authMiddleware");
// const resolveTenant = require("../middleware/tenantMiddleware");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// router.get("/", getNotifications);

// router.get("/unread-count", getUnreadCount);

// router.post("/test", createTestNotification);

// router.patch("/:id/read", markAsRead);

// router.patch("/read-all", markAllAsRead);

// router.post("/test-typed", createTypedTestNotification);

// module.exports = router;


const express = require("express");

const {
  getNotifications,
  getUnreadCount,
  createTestNotification,
  createTypedTestNotification,
  markAsRead,
  markAllAsRead,
  getMyDeviceTokens,
  testFcmPush,
} = require("../controllers/notificationController");

const verifyToken = require(
  "../middleware/authMiddleware",
);

const resolveTenant = require(
  "../middleware/tenantMiddleware",
);

const router = express.Router();

router.use(
  verifyToken,
  resolveTenant,
);

router.get(
  "/",
  getNotifications,
);

router.get(
  "/unread-count",
  getUnreadCount,
);

router.get(
  "/device-tokens",
  getMyDeviceTokens,
);

router.post(
  "/test",
  createTestNotification,
);

router.post(
  "/test-typed",
  createTypedTestNotification,
);

router.post(
  "/test-fcm",
  testFcmPush,
);

/*
  Keep literal/static routes above
  dynamic routes such as "/:id/read".
*/
router.patch(
  "/read-all",
  markAllAsRead,
);

router.patch(
  "/:id/read",
  markAsRead,
);

module.exports = router;