const AppVersion = require("../models/appVersion.model");

const {
  sendAppUpdateNotification,
} = require("../services/appUpdate.service");

const compareVersions = (versionA, versionB) => {
  const a = versionA.split(".").map(Number);
  const b = versionB.split(".").map(Number);

  for (let i = 0; i < 3; i += 1) {
    const first = a[i] || 0;
    const second = b[i] || 0;

    if (first > second) return 1;
    if (first < second) return -1;
  }

  return 0;
};

const checkAppVersion = async (req, res) => {
  try {
    const { currentVersion } = req.body;

    if (!currentVersion) {
      return res.status(400).json({
        success: false,
        message: "currentVersion is required",
      });
    }

    const appVersion = await AppVersion.findOne({
      platform: "android",
      isActive: true,
    }).sort({ createdAt: -1 });

    if (!appVersion) {
      return res.status(200).json({
        success: true,
        data: {
          updateRequired: false,
          updateAvailable: false,
        },
      });
    }

    const updateAvailable =
      compareVersions(
        appVersion.latestVersion,
        currentVersion,
      ) > 0;

    const updateRequired =
      compareVersions(
        appVersion.minimumVersion,
        currentVersion,
      ) > 0;

    let notificationResult = null;

    if (updateAvailable) {
      notificationResult = await sendAppUpdateNotification({
        userId: req.user._id,
        currentVersion,
        latestVersion: appVersion.latestVersion,
        downloadUrl: appVersion.downloadUrl,
        releaseNotes: appVersion.releaseNotes,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        updateAvailable,
        updateRequired,
        latestVersion: appVersion.latestVersion,
        minimumVersion: appVersion.minimumVersion,
        downloadUrl: appVersion.downloadUrl,
        releaseNotes: appVersion.releaseNotes,
        notification: notificationResult,
      },
    });
  } catch (error) {
    console.error("App version check failed:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to check app version",
    });
  }
};

const createAppVersion = async (req, res) => {
  try {
    const {
      platform = "android",
      latestVersion,
      minimumVersion,
      downloadUrl,
      releaseNotes,
    } = req.body;

    if (!latestVersion || !minimumVersion || !downloadUrl) {
      return res.status(400).json({
        success: false,
        message:
          "latestVersion, minimumVersion and downloadUrl are required",
      });
    }

    await AppVersion.updateMany(
      { platform },
      { isActive: false },
    );

    const appVersion = await AppVersion.create({
      platform,
      latestVersion,
      minimumVersion,
      downloadUrl,
      releaseNotes,
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      data: appVersion,
    });
  } catch (error) {
    console.error("Create app version failed:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create app version",
    });
  }
};

module.exports = {
  checkAppVersion,
  createAppVersion,
};