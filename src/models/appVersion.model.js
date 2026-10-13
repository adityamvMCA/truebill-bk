const mongoose = require("mongoose");

const appVersionSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ["android", "ios"],
      required: true,
      default: "android",
    },

    latestVersion: {
      type: String,
      required: true,
    },

    minimumVersion: {
      type: String,
      required: true,
    },

    downloadUrl: {
      type: String,
      required: true,
    },

    releaseNotes: {
      type: String,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "AppVersion",
  appVersionSchema,
);