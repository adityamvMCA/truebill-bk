const NotificationPreference = require("../models/NotificationPreference");

const getPreferences = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    let preferences = await NotificationPreference.findOne({
      tenantId,
      userId,
    }).lean();

    if (!preferences) {
      preferences = await NotificationPreference.create({
        tenantId,
        userId,
      });

      preferences = preferences.toObject();
    }

    return res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    next(error);
  }
};

const updatePreferences = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const allowedFields = [
      "lowStock",
      "salesOrder",
      "purchaseOrder",
      "paymentReceived",
      "paymentOverdue",
      "approvalRequired",
      "newCustomer",
      "system",
      "appUpdate",
      "pushEnabled",
      "soundEnabled",
      "vibrationEnabled",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (typeof req.body[field] === "boolean") {
        updates[field] = req.body[field];
      }
    }

    const preferences = await NotificationPreference.findOneAndUpdate(
      {
        tenantId,
        userId,
      },
      {
        $set: updates,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    next(error);
  }
};

const resetPreferences = async (req, res, next) => {
  try {
    const { tenantId, userId } = req.user;

    const preferences = await NotificationPreference.findOneAndUpdate(
      {
        tenantId,
        userId,
      },
      {
        $set: {
          lowStock: true,
          salesOrder: true,
          purchaseOrder: true,
          paymentReceived: true,
          paymentOverdue: true,
          approvalRequired: true,
          newCustomer: true,
          system: true,
          appUpdate: true,
          pushEnabled: true,
          soundEnabled: true,
          vibrationEnabled: true,
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
      data: preferences,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPreferences,
  updatePreferences,
  resetPreferences,
};
