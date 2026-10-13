const { getMessaging } = require("firebase-admin/messaging");

const NotificationToken = require("../models/notificationToken.model");

const sendAppUpdateNotification = async ({
  userId,
  currentVersion,
  latestVersion,
  downloadUrl,
  releaseNotes = "",
}) => {
  const tokenDocs = await NotificationToken.find({
    user: userId,
    isActive: true,
  });

  if (tokenDocs.length === 0) {
    return {
      sent: false,
      reason: "No active FCM tokens",
      tokensFound: 0,
      successCount: 0,
      failureCount: 0,
    };
  }

  const tokens = tokenDocs.map((tokenDoc) => tokenDoc.token);

  const title = "Update Available";
  const body =
    releaseNotes ||
    `A new version of TrustIQ is available. Please update from version ${currentVersion} to ${latestVersion}.`;

  const message = {
    tokens,

    notification: {
      title,
      body,
    },

    android: {
      priority: "high",

      notification: {
        title,
        body,
        icon: "ic_notification",
        color: "#7C3AED",
        channelId: "default",
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
    },

    data: {
      type: "APP_UPDATE_AVAILABLE",
      currentVersion: String(currentVersion),
      latestVersion: String(latestVersion),
      downloadUrl,
      screen: "AppUpdate",
    },
  };

  const response = await getMessaging().sendEachForMulticast(message);

  const failures = response.responses
    .map((result, index) =>
      result.success
        ? null
        : {
            tokenIndex: index,
            errorCode: result.error?.code,
            errorMessage: result.error?.message,
          },
    )
    .filter(Boolean);

  return {
    sent: response.successCount > 0,
    tokensFound: tokens.length,
    successCount: response.successCount,
    failureCount: response.failureCount,
    failures,
  };
};

module.exports = {
  sendAppUpdateNotification,
};