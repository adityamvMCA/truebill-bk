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
  NEW_SUPPLIER: "newSupplier",
  SYSTEM: "system",
  APP_UPDATE: "appUpdate",
};

const PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
];

/*
  Android status-bar icons must be white artwork
  on a transparent background.

  These values refer to files in:
  android/app/src/main/res/drawable/
*/
const ANDROID_NOTIFICATION_ICONS = {
  bell: "ic_stat_truebill",
  smartphone: "ic_stat_truebill",
  "low-stock": "ic_stat_truebill",
  "sales-order": "ic_stat_truebill",
  "purchase-order": "ic_stat_truebill",
  payment: "ic_stat_truebill",
  "payment-overdue": "ic_stat_truebill",
  approval: "ic_stat_truebill",
  customer: "ic_stat_truebill",
  system: "ic_stat_truebill",
  warning: "ic_stat_truebill",
};

/*
  Android notification accent colors by type.
  These are colors shown behind/with the white icon.
*/
const ANDROID_NOTIFICATION_COLORS = {
  LOW_STOCK: "#F59E0B",
  SALES_ORDER: "#2563EB",
  PURCHASE_ORDER: "#059669",
  PAYMENT_RECEIVED: "#16A34A",
  PAYMENT_OVERDUE: "#DC2626",
  APPROVAL_REQUIRED: "#0EA5E9",
  NEW_CUSTOMER: "#6366F1",
  SYSTEM: "#475569",
  APP_UPDATE: "#7C3AED",
};

const DEFAULT_ANDROID_ICON = "ic_stat_truebill";
const DEFAULT_ANDROID_COLOR = "#7C3AED";

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

const getAndroidIcon = (icon) =>
  ANDROID_NOTIFICATION_ICONS[icon] ||
  DEFAULT_ANDROID_ICON;

const getAndroidColor = (type) =>
  ANDROID_NOTIFICATION_COLORS[type] ||
  DEFAULT_ANDROID_COLOR;

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

    const androidIcon = getAndroidIcon(
      notification.icon,
    );

    const androidColor = getAndroidColor(
      notification.type,
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
            title: notification.title,
            body: notification.message,
            icon: androidIcon,
            color: androidColor,
            channelId: "default",
            sound:
              preferences.soundEnabled === false
                ? undefined
                : "default",
            clickAction:
              "FLUTTER_NOTIFICATION_CLICK",
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

const createForTenant = async ({
  tenantId,
  type,
  title,
  message,
  icon = "bell",
  priority = "NORMAL",
  route = null,
  data = {},
  excludeUserId = null,
}) => {
  const preferenceKey = preferenceMap[type];

  if (!preferenceKey) {
    throw new Error(
      `Unsupported notification type: ${type}`,
    );
  }

  const users = await User.find({
    tenantId,
    isActive: true,
    isDeleted: false,
  })
    .select("_id")
    .lean();

  if (users.length === 0) {
    return {
      created: 0,
      notifications: [],
    };
  }

  const userIds = users
    .map((user) => user._id.toString())
    .filter((id) => id !== excludeUserId);

  const preferences = await NotificationPreference.find({
    tenantId,
    userId: {
      $in: userIds,
    },
  })
    .select("userId")
    .lean();

  const enabledPreferenceUserIds = new Set(
    preferences
      .filter(
        (preference) => preference[preferenceKey] !== false,
      )
      .map((preference) =>
        preference.userId.toString(),
      ),
  );

  /*
    Users without a preference document receive
    the notification because defaults are true.
  */
  const usersWithPreference = new Set(
    preferences.map((preference) =>
      preference.userId.toString(),
    ),
  );

  const finalUserIds = userIds.filter((id) => {
    if (!usersWithPreference.has(id)) {
      return true;
    }

    return enabledPreferenceUserIds.has(id);
  });

  if (finalUserIds.length === 0) {
    return {
      created: 0,
      notifications: [],
    };
  }

  const notifications = await Notification.insertMany(
    finalUserIds.map((recipientUserId) => ({
      tenantId,
      userId: recipientUserId,
      type,
      title,
      message,
      icon,
      priority,
      route,
      data,
      isRead: false,
      readAt: null,
    })),
  );

  return {
    created: notifications.length,
    notifications,
  };
};

module.exports = {
  create,
  createMany,
  sendAppUpdateNotification,
  sendPush,
  createForTenant
};