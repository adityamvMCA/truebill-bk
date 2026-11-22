const mongoose = require("mongoose");

const emailNotificationLogSchema = new mongoose.Schema(
  {
    to: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    templateType: {
      type: String,
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["SENT", "FAILED"],
      default: "SENT",
      index: true,
    },
    messageId: {
      type: String,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    triggeredBy: {
      type: String,
      default: "SYSTEM_AUTOMATION", // e.g. "DEVELOPER_CONSOLE" or user id or "CRON"
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.EmailNotificationLog ||
  mongoose.model("EmailNotificationLog", emailNotificationLogSchema);
