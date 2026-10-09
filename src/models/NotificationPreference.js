const mongoose = require("mongoose");

const notificationPreferenceSchema = new mongoose.Schema(
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
      unique: true,
      index: true,
    },

    lowStock: {
      type: Boolean,
      default: true,
    },

    salesOrder: {
      type: Boolean,
      default: true,
    },

    purchaseOrder: {
      type: Boolean,
      default: true,
    },

    paymentReceived: {
      type: Boolean,
      default: true,
    },

    paymentOverdue: {
      type: Boolean,
      default: true,
    },

    approvalRequired: {
      type: Boolean,
      default: true,
    },

    newCustomer: {
      type: Boolean,
      default: true,
    },

    system: {
      type: Boolean,
      default: true,
    },

    appUpdate: {
      type: Boolean,
      default: true,
    },

    pushEnabled: {
      type: Boolean,
      default: true,
    },

    soundEnabled: {
      type: Boolean,
      default: true,
    },

    vibrationEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

notificationPreferenceSchema.index({
  tenantId: 1,
  userId: 1,
});

module.exports = mongoose.model(
  "NotificationPreference",
  notificationPreferenceSchema,
);