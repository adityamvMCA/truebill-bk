const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    token: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    platform: {
      type: String,
      enum: ["ANDROID", "WEB"],
      required: true,
      index: true,
    },

    browser: {
      type: String,
      default: null,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

deviceTokenSchema.index({
  tenantId: 1,
  userId: 1,
  platform: 1,
  isActive: 1,
});

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
