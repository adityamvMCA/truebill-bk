// const Notification = require("../models/Notification");
// const NotificationService = require("../services/notificationService");
// const getNotifications = async (req, res, next) => {
//   try {
//     // const { tenantId, userId } = req.user;
//     const tenantId = req.tenantId;
//     const userId = req.user.userId;

//     const page = Math.max(Number(req.query.page) || 1, 1);
//     const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
//     const skip = (page - 1) * limit;

//     const [notifications, total] = await Promise.all([
//       Notification.find({
//         tenantId,
//         userId,
//       })
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),

//       Notification.countDocuments({
//         tenantId,
//         userId,
//       }),
//     ]);

//     const unreadCount = await Notification.countDocuments({
//       tenantId,
//       userId,
//       isRead: false,
//     });

//     return res.status(200).json({
//       success: true,
//       data: {
//         notifications,
//         unreadCount,
//         pagination: {
//           page,
//           limit,
//           total,
//           totalPages: Math.ceil(total / limit),
//         },
//       },
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getUnreadCount = async (req, res, next) => {
//   try {
//     // const { tenantId, userId } = req.user;
//     const tenantId = req.tenantId;
//     const userId = req.user.userId;

//     const unreadCount = await Notification.countDocuments({
//       tenantId,
//       userId,
//       isRead: false,
//     });

//     return res.status(200).json({
//       success: true,
//       data: {
//         unreadCount,
//       },
//     });
//   } catch (error) {
//     next(error);
//   }
// };
// const createTestNotification = async (req, res, next) => {
//   try {
//     // const { tenantId, userId } = req.user;
//     const tenantId = req.tenantId;
//     const userId = req.user.userId;

//     const notification = await NotificationService.create({
//       tenantId,
//       userId,
//       type: "SYSTEM",
//       title: "Test Notification",
//       message: "This is a test notification from TrueBill.",
//       icon: "bell",
//       priority: "NORMAL",
//       route: "/",
//       data: {
//         test: true,
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       data: notification,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const markAsRead = async (req, res, next) => {
//   try {
//     // const { tenantId, userId } = req.user;
//     const tenantId = req.tenantId;
//     const userId = req.user.userId;
//     const { id } = req.params;

//     const notification = await Notification.findOneAndUpdate(
//       {
//         _id: id,
//         tenantId,
//         userId,
//       },
//       {
//         $set: {
//           isRead: true,
//           readAt: new Date(),
//         },
//       },
//       {
//         new: true,
//       },
//     );

//     if (!notification) {
//       return res.status(404).json({
//         success: false,
//         message: "Notification not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       data: notification,
//     });
//   } catch (error) {
//     next(error);
//   }
// };
// const markAllAsRead = async (req, res, next) => {
//   try {
//     // const { tenantId, userId } = req.user;
//     const tenantId = req.tenantId;
//     const userId = req.user.userId;

//     await Notification.updateMany(
//       {
//         tenantId,
//         userId,
//         isRead: false,
//       },
//       {
//         $set: {
//           isRead: true,
//           readAt: new Date(),
//         },
//       },
//     );

//     return res.status(200).json({
//       success: true,
//       message: "All notifications marked as read",
//     });
//   } catch (error) {
//     next(error);
//   }
// };
// // const createTypedTestNotification = async (req, res, next) => {
// //   try {
// //     const { tenantId, userId } = req.user;
// //     const {
// //       type = "SYSTEM",
// //       title = "Typed Test Notification",
// //       message = "This is a typed test notification.",
// //       priority = "NORMAL",
// //     } = req.body;

// //     const allowedTypes = [
// //       "LOW_STOCK",
// //       "SALES_ORDER",
// //       "PURCHASE_ORDER",
// //       "PAYMENT_RECEIVED",
// //       "PAYMENT_OVERDUE",
// //       "APPROVAL_REQUIRED",
// //       "NEW_CUSTOMER",
// //       "SYSTEM",
// //       "APP_UPDATE",
// //     ];

// //     if (!allowedTypes.includes(type)) {
// //       return res.status(400).json({
// //         success: false,
// //         message: "Invalid notification type",
// //       });
// //     }

// //     const notification = await NotificationService.create({
// //       tenantId,
// //       userId,
// //       type,
// //       title,
// //       message,
// //       priority,
// //       icon: "bell",
// //       route: "/",
// //       data: {
// //         test: true,
// //       },
// //     });

// //     return res.status(201).json({
// //       success: true,
// //       data: notification,
// //       blocked: notification === null,
// //     });
// //   } catch (error) {
// //     next(error);
// //   }
// // };

// const createTypedTestNotification = async (req, res, next) => {
//   try {
//     // const { tenantId, userId } = req.user;
//     const tenantId = req.tenantId;
//     const userId = req.user.userId;

//     const {
//       type = "SYSTEM",
//       title = "Typed Test Notification",
//       message = "This is a typed test notification.",
//       priority = "NORMAL",
//     } = req.body;

//     const notificationConfig = {
//       LOW_STOCK: {
//         icon: "boxes",
//         priority: "HIGH",
//       },
//       SALES_ORDER: {
//         icon: "shopping-cart",
//         priority: "NORMAL",
//       },
//       PURCHASE_ORDER: {
//         icon: "package",
//         priority: "NORMAL",
//       },
//       PAYMENT_RECEIVED: {
//         icon: "circle-dollar-sign",
//         priority: "NORMAL",
//       },
//       PAYMENT_OVERDUE: {
//         icon: "calendar-clock",
//         priority: "HIGH",
//       },
//       APPROVAL_REQUIRED: {
//         icon: "clipboard-check",
//         priority: "HIGH",
//       },
//       NEW_CUSTOMER: {
//         icon: "user-plus",
//         priority: "NORMAL",
//       },
//       SYSTEM: {
//         icon: "bell",
//         priority: "NORMAL",
//       },
//       APP_UPDATE: {
//         icon: "smartphone",
//         priority: "NORMAL",
//       },
//     };

//     const allowedTypes = Object.keys(notificationConfig);

//     if (!allowedTypes.includes(type)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid notification type",
//       });
//     }

//     const config = notificationConfig[type];

//     const notification = await NotificationService.create({
//       tenantId,
//       userId,
//       type,
//       title,
//       message,
//       priority,
//       icon: config.icon,
//       route: "/",
//       data: {
//         test: true,
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       data: notification,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// module.exports = {
//   getNotifications,
//   getUnreadCount,
//   createTestNotification,
//   markAsRead,
//   markAllAsRead,
//   createTypedTestNotification,
// };



const mongoose = require("mongoose");

const Notification = require("../models/Notification");
const DeviceToken = require("../models/DeviceToken");

const NotificationService = require(
  "../services/notificationService",
);

const {
  getMessaging,
} = require("firebase-admin/messaging");

const isValidObjectId = (value) =>
  mongoose.isValidObjectId(value);

const getRequestContext = (req) => {
  const tenantId =
    req.tenantId || req.user?.tenantId;

  const userId =
    req.user?.userId ||
    req.user?.id ||
    req.user?._id;

  return {
    tenantId,
    userId,
  };
};

const getNotifications = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const page = Math.max(
      Number(req.query.page) || 1,
      1,
    );

    const limit = Math.min(
      Math.max(
        Number(req.query.limit) || 20,
        1,
      ),
      100,
    );

    const skip = (page - 1) * limit;

    const filter = {
      tenantId,
      userId,
    };

    const [
      notifications,
      total,
      unreadCount,
    ] = await Promise.all([
      Notification.find(filter)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      Notification.countDocuments(filter),

      Notification.countDocuments({
        ...filter,
        isRead: false,
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(
            total / limit,
          ),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getUnreadCount = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const unreadCount =
      await Notification.countDocuments({
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

const createTestNotification = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const notification =
      await NotificationService.create({
        tenantId,
        userId,
        type: "SYSTEM",
        title: "Test Notification",
        message:
          "This is a test notification from TrueBill.",
        icon: "bell",
        priority: "NORMAL",
        route: "/",
        data: {
          test: true,
        },
      });

    if (!notification) {
      return res.status(200).json({
        success: true,
        message:
          "Notification blocked by user preferences",
        data: null,
        blocked: true,
      });
    }

    return res.status(201).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

const createTypedTestNotification = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const {
      type = "SYSTEM",
      title = "Typed Test Notification",
      message =
        "This is a typed test notification.",
      priority,
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

    const normalizedType = String(type)
      .trim()
      .toUpperCase();

    if (
      !notificationConfig[normalizedType]
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification type",
      });
    }

    const config =
      notificationConfig[normalizedType];

    const allowedPriorities = [
      "LOW",
      "NORMAL",
      "HIGH",
      "CRITICAL",
    ];

    const normalizedPriority = priority
      ? String(priority).trim().toUpperCase()
      : config.priority;

    if (
      !allowedPriorities.includes(
        normalizedPriority,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification priority",
      });
    }

    const notification =
      await NotificationService.create({
        tenantId,
        userId,
        type: normalizedType,
        title: String(title).trim(),
        message: String(message).trim(),
        priority: normalizedPriority,
        icon: config.icon,
        route: "/",
        data: {
          test: true,
        },
      });

    if (!notification) {
      return res.status(200).json({
        success: true,
        message:
          "Notification blocked by user preferences",
        data: null,
        blocked: true,
      });
    }

    return res.status(201).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    const { id } = req.params;

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const notification =
      await Notification.findOneAndUpdate(
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
        message:
          "Notification not found",
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

const markAllAsRead = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const result =
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
      message:
        "All notifications marked as read",
      data: {
        updatedCount:
          result.modifiedCount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getMyDeviceTokens = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const tokens =
      await DeviceToken.find({
        tenantId,
        userId,
      })
        .select(
          "platform browser isActive lastUsedAt createdAt updatedAt token",
        )
        .sort({
          updatedAt: -1,
        })
        .lean();

    return res.status(200).json({
      success: true,
      data: {
        total: tokens.length,
        tokens,
      },
    });
  } catch (error) {
    next(error);
  }
};

const testFcmPush = async (
  req,
  res,
  next,
) => {
  try {
    const {
      tenantId,
      userId,
    } = getRequestContext(req);

    if (!tenantId || !userId) {
      return res.status(400).json({
        success: false,
        message:
          "Tenant or user context is missing",
      });
    }

    const deviceTokens =
      await DeviceToken.find({
        tenantId,
        userId,
        platform: "ANDROID",
        isActive: true,
      })
        .sort({
          lastUsedAt: -1,
        })
        .lean();

    if (!deviceTokens.length) {
      return res.status(404).json({
        success: false,
        message:
          "No active Android device token found",
      });
    }

    const tokens = deviceTokens.map(
      (deviceToken) =>
        deviceToken.token,
    );

    const response =
      await getMessaging().sendEachForMulticast({
        tokens,

        notification: {
          title: "TrueBill FCM Test",
          body:
            "This push was sent directly from your backend.",
        },

        data: {
          type: "SYSTEM",
          route: "/",
          source: "backend-fcm-test",
        },

        android: {
          priority: "high",

          notification: {
            channelId: "default",
            sound: "default",
          },
        },
      });

    const failures = response.responses
      .map((result, index) => ({
        token: tokens[index],
        success: result.success,
        errorCode:
          result.error?.code || null,
        errorMessage:
          result.error?.message || null,
      }))
      .filter(
        (result) => !result.success,
      );

    const invalidTokens = failures
      .filter((result) =>
        [
          "messaging/invalid-registration-token",
          "messaging/registration-token-not-registered",
        ].includes(result.errorCode),
      )
      .map((result) => result.token);

    if (invalidTokens.length > 0) {
      await DeviceToken.updateMany(
        {
          token: {
            $in: invalidTokens,
          },
        },
        {
          $set: {
            isActive: false,
          },
        },
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        tokensFound: tokens.length,
        successCount:
          response.successCount,
        failureCount:
          response.failureCount,
        failures,
        invalidTokensDeactivated:
          invalidTokens.length,
      },
    });
  } catch (error) {
    console.error(
      "Direct FCM test error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Direct FCM test failed",
      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  createTestNotification,
  createTypedTestNotification,
  markAsRead,
  markAllAsRead,
  getMyDeviceTokens,
  testFcmPush,
};