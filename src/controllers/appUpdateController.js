const User = require("../models/User");
const APP_VERSION = require("../config/appVersion");
const NotificationService = require("../services/notificationService");

const notifyAndroidAppUpdate = async (req, res, next) => {
  try {
    const android = APP_VERSION.android;

    const users = await User.find({
      isActive: true,
      tenantId: { $exists: true, $ne: null },
    })
      .select("_id tenantId")
      .lean();

    let created = 0;
    let skipped = 0;

    for (const user of users) {
      const notification =
        await NotificationService.sendAppUpdateNotification({
          tenantId: user.tenantId,
          userId: user._id,
          latestVersion: android.latestVersion,
          minimumVersion: android.minimumVersion,
          updateRequired: android.updateRequired,
          downloadUrl: android.downloadUrl,
        });

      if (notification) {
        created += 1;
      } else {
        skipped += 1;
      }
    }

    return res.status(200).json({
      success: true,
      message: "App update notifications sent",
      data: {
        latestVersion: android.latestVersion,
        usersProcessed: users.length,
        notificationsCreated: created,
        skippedByPreference: skipped,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  notifyAndroidAppUpdate,
};