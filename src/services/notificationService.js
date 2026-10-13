

// const Notification = require("../models/Notification");
// const NotificationPreference = require("../models/NotificationPreference");

// const preferenceMap = {
//   LOW_STOCK: "lowStock",
//   SALES_ORDER: "salesOrder",
//   PURCHASE_ORDER: "purchaseOrder",
//   PAYMENT_RECEIVED: "paymentReceived",
//   PAYMENT_OVERDUE: "paymentOverdue",
//   APPROVAL_REQUIRED: "approvalRequired",
//   NEW_CUSTOMER: "newCustomer",
//   SYSTEM: "system",
//   APP_UPDATE: "appUpdate",
// };

// const create = async ({
//   tenantId,
//   userId,
//   type,
//   title,
//   message,
//   icon = "bell",
//   priority = "NORMAL",
//   route = null,
//   data = {},
// }) => {
//   if (!tenantId) {
//     throw new Error("tenantId is required");
//   }

//   if (!userId) {
//     throw new Error("userId is required");
//   }

//   if (!type) {
//     throw new Error("Notification type is required");
//   }

//   if (!title) {
//     throw new Error("Notification title is required");
//   }

//   if (!message) {
//     throw new Error("Notification message is required");
//   }

//   const preferenceField = preferenceMap[type];

//   if (preferenceField) {
//     const preferences =
//       await NotificationPreference.findOne({
//         tenantId,
//         userId,
//       }).lean();

//     if (
//       preferences &&
//       preferences[preferenceField] === false
//     ) {
//       return null;
//     }

//     if (
//       preferences &&
//       preferences.pushEnabled === false
//     ) {
//       return null;
//     }
//   }

//   return Notification.create({
//     tenantId,
//     userId,
//     type,
//     title,
//     message,
//     icon,
//     priority,
//     route,
//     data,
//   });
// };

// const createMany = async (notifications) => {
//   if (
//     !Array.isArray(notifications) ||
//     notifications.length === 0
//   ) {
//     return [];
//   }

//   const results = [];

//   for (const notification of notifications) {
//     const created = await create(notification);

//     if (created) {
//       results.push(created);
//     }
//   }

//   return results;
// };

// const sendAppUpdateNotification = async ({
//   tenantId,
//   userId,
//   latestVersion,
//   minimumVersion,
//   updateRequired,
//   downloadUrl,
// }) => {
//   const requiredUpdate =
//     updateRequired === true ||
//     updateRequired === "true";

//   const title = requiredUpdate
//     ? "Update required"
//     : "New app update available";

//   const message = requiredUpdate
//     ? `TrueBill version ${latestVersion} is required. Please update to continue.`
//     : `TrueBill version ${latestVersion} is now available. Update for the latest improvements.`;

//   const payload = {
//     tenantId,
//     userId,
//     type: "APP_UPDATE",
//     title,
//     message,
//     icon: "smartphone",
//     priority: requiredUpdate
//       ? "CRITICAL"
//       : "NORMAL",
//     route: "/app-update",
//     data: {
//       platform: "android",
//       latestVersion,
//       minimumVersion,
//       updateRequired: requiredUpdate,
//       downloadUrl,
//     },
//   };

//   if (requiredUpdate) {
//     return Notification.create(payload);
//   }

//   return create(payload);
// };

// module.exports = {
//   create,
//   createMany,
//   sendAppUpdateNotification,
// };

const Notification = require("../models/Notification");
const NotificationPreference = require(
  "../models/NotificationPreference",
);
const DeviceToken = require("../models/DeviceToken");

const {
  getMessaging,
} = require("firebase-admin/messaging");

const preferenceMap = {
  LOW_STOCK: "lowStock",
  SALES_ORDER: "salesOrder",
  PURCHASE_ORDER: "purchaseOrder",
  PAYMENT_RECEIVED: "paymentReceived",
  PAYMENT_OVERDUE: "paymentOverdue",
  APPROVAL_REQUIRED: "approvalRequired",
  NEW_CUSTOMER: "newCustomer",
  SYSTEM: "system",
  APP_UPDATE: "appUpdate",
};

const PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
];

const normalizeType = (type) =>
  String(type || "")
    .trim()
    .toUpperCase();

const normalizePriority = (priority) => {
  const normalized = String(
    priority || "NORMAL",
  )
    .trim()
    .toUpperCase();

  return PRIORITIES.includes(normalized)
    ? normalized
    : "NORMAL";
};

const toFcmStringData = (data = {}) => {
  const result = {};

  for (const [key, value] of Object.entries(
    data || {},
  )) {
    if (
      value === undefined ||
      value === null
    ) {
      continue;
    }

    if (typeof value === "string") {
      result[key] = value;
      continue;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = String(value);
      continue;
    }

    result[key] = JSON.stringify(value);
  }

  return result;
};

const isInvalidTokenError = (errorCode) =>
  [
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ].includes(errorCode);

const shouldSendHighPriority = (priority) =>
  ["HIGH", "CRITICAL"].includes(priority);

const getPreferences = async (
  tenantId,
  userId,
) => {
  let preferences =
    await NotificationPreference.findOne({
      tenantId,
      userId,
    });

  if (!preferences) {
    preferences =
      await NotificationPreference.create({
        tenantId,
        userId,
      });
  }

  return preferences;
};

const isCategoryEnabled = (
  preferences,
  type,
) => {
  const preferenceField =
    preferenceMap[type];

  if (!preferenceField) {
    return true;
  }

  return preferences[preferenceField] !== false;
};

const deactivateInvalidTokens = async (
  tokens,
) => {
  if (!tokens.length) {
    return;
  }

  await DeviceToken.updateMany(
    {
      token: {
        $in: tokens,
      },
    },
    {
      $set: {
        isActive: false,
      },
    },
  );
};

const updateLastUsedTokens = async (
  tokens,
) => {
  if (!tokens.length) {
    return;
  }

  await DeviceToken.updateMany(
    {
      token: {
        $in: tokens,
      },
    },
    {
      $set: {
        lastUsedAt: new Date(),
      },
    },
  );
};

const sendPush = async ({
  notification,
  preferences,
}) => {
  try {
    if (preferences.pushEnabled === false) {
      console.log(
        `Push disabled for user ${notification.userId}`,
      );

      return {
        skipped: true,
        reason: "PUSH_DISABLED",
        tokensFound: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    const deviceTokens =
      await DeviceToken.find({
        tenantId: notification.tenantId,
        userId: notification.userId,
        isActive: true,
      })
        .select(
          "token platform isActive lastUsedAt",
        )
        .lean();

    if (!deviceTokens.length) {
      console.log(
        `No active device tokens for user ${notification.userId}`,
      );

      return {
        skipped: true,
        reason: "NO_ACTIVE_DEVICE_TOKENS",
        tokensFound: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    const tokens = deviceTokens
      .map((device) => device.token)
      .filter(Boolean);

    if (!tokens.length) {
      return {
        skipped: true,
        reason: "NO_VALID_DEVICE_TOKENS",
        tokensFound: 0,
        successCount: 0,
        failureCount: 0,
      };
    }

    const priority = normalizePriority(
      notification.priority,
    );

    const fcmData = {
      notificationId: String(
        notification._id,
      ),
      tenantId: String(
        notification.tenantId,
      ),
      userId: String(notification.userId),
      type: String(notification.type),
      route: notification.route || "",
      icon: notification.icon || "bell",
      priority,
      ...toFcmStringData(notification.data),
    };

    const response =
      await getMessaging().sendEachForMulticast({
        tokens,

        notification: {
          title: notification.title,
          body: notification.message,
        },

        data: fcmData,

        android: {
          priority: shouldSendHighPriority(
            priority,
          )
            ? "high"
            : "normal",

          notification: {
            channelId: "default",
            sound:
              preferences.soundEnabled === false
                ? undefined
                : "default",
          },
        },
      });

    const invalidTokens = [];

    const failures = response.responses
      .map((result, index) => {
        const token = tokens[index];

        if (
          !result.success &&
          isInvalidTokenError(
            result.error?.code,
          )
        ) {
          invalidTokens.push(token);
        }

        return {
          platform:
            deviceTokens[index]?.platform ||
            null,
          success: result.success,
          errorCode:
            result.error?.code || null,
          errorMessage:
            result.error?.message || null,
        };
      })
      .filter((result) => !result.success);

    if (invalidTokens.length) {
      await deactivateInvalidTokens(
        invalidTokens,
      );
    }

    const successfulTokens =
      response.responses
        .map((result, index) =>
          result.success ? tokens[index] : null,
        )
        .filter(Boolean);

    if (successfulTokens.length) {
      await updateLastUsedTokens(
        successfulTokens,
      );
    }

    const summary = {
      skipped: false,
      tokensFound: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokensDeactivated:
        invalidTokens.length,
      failures,
    };

    console.log(
      "FCM push result:",
      JSON.stringify(summary, null, 2),
    );

    return summary;
  } catch (error) {
    /*
      Do not throw here. Notification is already saved
      in MongoDB and must remain visible in-app even
      if external FCM delivery fails.
    */
    console.error(
      "FCM push delivery failed:",
      error?.code || error?.message || error,
    );

    return {
      skipped: false,
      error: true,
      errorCode: error?.code || null,
      errorMessage:
        error?.message ||
        "Unknown FCM delivery error",
      tokensFound: 0,
      successCount: 0,
      failureCount: 0,
      failures: [],
    };
  }
};

const create = async ({
  tenantId,
  userId,
  type,
  title,
  message,
  icon = "bell",
  priority = "NORMAL",
  route = null,
  data = {},
}) => {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const normalizedType = normalizeType(type);

  if (!normalizedType) {
    throw new Error(
      "Notification type is required",
    );
  }

  if (!preferenceMap[normalizedType]) {
    throw new Error(
      `Invalid notification type: ${normalizedType}`,
    );
  }

  if (!String(title || "").trim()) {
    throw new Error(
      "Notification title is required",
    );
  }

  if (!String(message || "").trim()) {
    throw new Error(
      "Notification message is required",
    );
  }

  const normalizedPriority =
    normalizePriority(priority);

  const preferences = await getPreferences(
    tenantId,
    userId,
  );

  if (
    !isCategoryEnabled(
      preferences,
      normalizedType,
    )
  ) {
    console.log(
      `Notification blocked by category preference: ${normalizedType}`,
    );

    return null;
  }

  const notification =
    await Notification.create({
      tenantId,
      userId,
      type: normalizedType,
      title: String(title).trim(),
      message: String(message).trim(),
      icon: String(icon || "bell").trim(),
      priority: normalizedPriority,
      route:
        route && String(route).trim()
          ? String(route).trim()
          : null,
      data: data || {},
    });

  /*
    Push delivery happens after database creation.
    A push failure must not fail the API request or
    delete the in-app notification.
  */
  const pushResult = await sendPush({
    notification,
    preferences,
  });

  /*
    Mongoose documents allow arbitrary properties only
    in memory. This is useful for API test responses but
    does not add pushResult to MongoDB.
  */
  notification.pushResult = pushResult;

  return notification;
};

const createMany = async (notifications) => {
  if (
    !Array.isArray(notifications) ||
    notifications.length === 0
  ) {
    return [];
  }

  const results = [];

  for (const notification of notifications) {
    const created = await create(notification);

    if (created) {
      results.push(created);
    }
  }

  return results;
};

const sendAppUpdateNotification = async ({
  tenantId,
  userId,
  latestVersion,
  minimumVersion,
  updateRequired,
  downloadUrl,
}) => {
  const requiredUpdate =
    updateRequired === true ||
    updateRequired === "true";

  const title = requiredUpdate
    ? "Update required"
    : "New app update available";

  const message = requiredUpdate
    ? `TrueBill version ${latestVersion} is required. Please update to continue.`
    : `TrueBill version ${latestVersion} is now available. Update for the latest improvements.`;

  const payload = {
    tenantId,
    userId,
    type: "APP_UPDATE",
    title,
    message,
    icon: "smartphone",
    priority: requiredUpdate
      ? "CRITICAL"
      : "NORMAL",
    route: "/app-update",
    data: {
      platform: "android",
      latestVersion,
      minimumVersion,
      updateRequired: requiredUpdate,
      downloadUrl,
    },
  };

  /*
    Required updates are persisted even when a user has
    disabled normal app-update notifications.
  */
  if (requiredUpdate) {
    const notification =
      await Notification.create(payload);

    const preferences = await getPreferences(
      tenantId,
      userId,
    );

    const pushResult = await sendPush({
      notification,
      preferences,
    });

    notification.pushResult = pushResult;

    return notification;
  }

  return create(payload);
};

module.exports = {
  create,
  createMany,
  sendAppUpdateNotification,
  sendPush,
};