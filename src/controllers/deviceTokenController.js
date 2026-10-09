const DeviceToken = require("../models/DeviceToken");

const registerDeviceToken = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;
    const { token, platform, browser = null } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    if (!["ANDROID", "WEB"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Platform must be ANDROID or WEB",
      });
    }

    const deviceToken = await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          tenantId,
          userId,
          platform,
          browser,
          isActive: true,
          lastUsedAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(200).json({
      success: true,
      data: deviceToken,
    });
  } catch (error) {
    next(error);
  }
};

const getDeviceTokens = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const tokens = await DeviceToken.find({
      tenantId,
      userId,
      isActive: true,
    }).sort({ updatedAt: -1 });

    return res.status(200).json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    next(error);
  }
};

const deactivateDeviceToken = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;
    const { id } = req.params;

    const deviceToken = await DeviceToken.findOneAndUpdate(
      {
        _id: id,
        tenantId,
        userId,
      },
      {
        $set: {
          isActive: false,
        },
      },
      {
        new: true,
      },
    );

    if (!deviceToken) {
      return res.status(404).json({
        success: false,
        message: "Device token not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: deviceToken,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerDeviceToken,
  getDeviceTokens,
  deactivateDeviceToken,
};
