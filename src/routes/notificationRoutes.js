
// const express = require("express");

// const {
//   getNotifications,
//   getUnreadCount,
//   createTestNotification,
//   createTypedTestNotification,
//   markAsRead,
//   markAllAsRead,
//   getMyDeviceTokens,
//   testFcmPush,
// } = require("../controllers/notificationController");

// const verifyToken = require(
//   "../middleware/authMiddleware",
// );

// const resolveTenant = require(
//   "../middleware/tenantMiddleware",
// );

// const router = express.Router();

// router.use(
//   verifyToken,
//   resolveTenant,
// );

// router.get(
//   "/",
//   getNotifications,
// );

// router.get(
//   "/unread-count",
//   getUnreadCount,
// );

// router.get(
//   "/device-tokens",
//   getMyDeviceTokens,
// );

// router.post(
//   "/test",
//   createTestNotification,
// );

// router.post(
//   "/test-typed",
//   createTypedTestNotification,
// );

// router.post(
//   "/test-fcm",
//   testFcmPush,
// );

// /*
//   Keep literal/static routes above
//   dynamic routes such as "/:id/read".
// */
// router.patch(
//   "/read-all",
//   markAllAsRead,
// );

// router.patch(
//   "/:id/read",
//   markAsRead,
// );

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
  createAppUpdateNotification,
} = require("../controllers/notificationController");

const verifyToken = require(
  "../middleware/authMiddleware",
);

const resolveTenant = require(
  "../middleware/tenantMiddleware",
);

const requireInternalNotificationSecret = require(
  "../middleware/internalNotificationMiddleware",
);

const router = express.Router();

/*
  This is intentionally before verifyToken and resolveTenant.

  It is for GitHub Actions / deployment automation.
  It does not require a logged-in user JWT.
  It is protected by x-internal-notification-secret.
*/
router.post(
  "/internal/app-update",
  requireInternalNotificationSecret,
  createAppUpdateNotification,
);

/*
  All normal user notification endpoints below require:
  1. Valid JWT
  2. Active tenant
*/
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
  Keep static paths above dynamic "/:id/read".
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