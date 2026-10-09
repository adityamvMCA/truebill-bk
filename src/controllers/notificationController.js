const Notification = require("../models/Notification");
const NotificationService = require("../services/notificationService");
const getNotifications = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find({
        tenantId,
        userId,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Notification.countDocuments({
        tenantId,
        userId,
      }),
    ]);

    const unreadCount = await Notification.countDocuments({
      tenantId,
      userId,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getUnreadCount = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const unreadCount = await Notification.countDocuments({
      tenantId,
      userId,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
};
const createTestNotification = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const notification = await NotificationService.create({
      tenantId,
      userId,
      type: "SYSTEM",
      title: "Test Notification",
      message: "This is a test notification from TrueBill.",
      icon: "bell",
      priority: "NORMAL",
      route: "/",
      data: {
        test: true,
      },
    });

    return res.status(201).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        tenantId,
        userId,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      {
        new: true,
      },
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};
const markAllAsRead = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    await Notification.updateMany(
      {
        tenantId,
        userId,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    next(error);
  }
};
// const createTypedTestNotification = async (req, res, next) => {
//   try {
//     const { tenantId, userId } = req.user;
//     const {
//       type = "SYSTEM",
//       title = "Typed Test Notification",
//       message = "This is a typed test notification.",
//       priority = "NORMAL",
//     } = req.body;

//     const allowedTypes = [
//       "LOW_STOCK",
//       "SALES_ORDER",
//       "PURCHASE_ORDER",
//       "PAYMENT_RECEIVED",
//       "PAYMENT_OVERDUE",
//       "APPROVAL_REQUIRED",
//       "NEW_CUSTOMER",
//       "SYSTEM",
//       "APP_UPDATE",
//     ];

//     if (!allowedTypes.includes(type)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid notification type",
//       });
//     }

//     const notification = await NotificationService.create({
//       tenantId,
//       userId,
//       type,
//       title,
//       message,
//       priority,
//       icon: "bell",
//       route: "/",
//       data: {
//         test: true,
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       data: notification,
//       blocked: notification === null,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

const createTypedTestNotification = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const {
      type = "SYSTEM",
      title = "Typed Test Notification",
      message = "This is a typed test notification.",
      priority = "NORMAL",
    } = req.body;

    const notificationConfig = {
      LOW_STOCK: {
        icon: "boxes",
        priority: "HIGH",
      },
      SALES_ORDER: {
        icon: "shopping-cart",
        priority: "NORMAL",
      },
      PURCHASE_ORDER: {
        icon: "package",
        priority: "NORMAL",
      },
      PAYMENT_RECEIVED: {
        icon: "circle-dollar-sign",
        priority: "NORMAL",
      },
      PAYMENT_OVERDUE: {
        icon: "calendar-clock",
        priority: "HIGH",
      },
      APPROVAL_REQUIRED: {
        icon: "clipboard-check",
        priority: "HIGH",
      },
      NEW_CUSTOMER: {
        icon: "user-plus",
        priority: "NORMAL",
      },
      SYSTEM: {
        icon: "bell",
        priority: "NORMAL",
      },
      APP_UPDATE: {
        icon: "smartphone",
        priority: "NORMAL",
      },
    };

    const allowedTypes = Object.keys(notificationConfig);

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification type",
      });
    }

    const config = notificationConfig[type];

    const notification = await NotificationService.create({
      tenantId,
      userId,
      type,
      title,
      message,
      priority,
      icon: config.icon,
      route: "/",
      data: {
        test: true,
      },
    });

    return res.status(201).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  createTestNotification,
  markAsRead,
  markAllAsRead,
  createTypedTestNotification,
};
