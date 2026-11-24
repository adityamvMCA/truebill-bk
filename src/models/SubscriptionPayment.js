const mongoose = require("mongoose");

const subscriptionPaymentSchema = new mongoose.Schema(
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
    },
    plan: {
      type: String,
      enum: ["trial", "basic", "standard", "premium"],
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly", "trial"],
      default: "yearly",
    },
    amount: {
      type: Number, // In INR rupees
      required: true,
      default: 0,
    },
    amountPaise: {
      type: Number, // In paise
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    razorpayOrderId: {
      type: String,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      index: true,
    },
    razorpaySignature: {
      type: String,
    },
    status: {
      type: String,
      enum: ["created", "paid", "failed", "trial_activated"],
      default: "created",
      index: true,
    },
    isTestMode: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    paidAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("SubscriptionPayment", subscriptionPaymentSchema);
