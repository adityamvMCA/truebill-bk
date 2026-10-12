const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    clientCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    businessName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    businessType: {
      type: String,
      default: "Trader",
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    gstNo: {
      type: String,
      uppercase: true,
      trim: true,
    },

    panNo: {
      type: String,
      uppercase: true,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
    },

    city: {
      type: String,
      trim: true,
    },

    state: {
      type: String,
      trim: true,
    },

    pincode: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: [
        "trial",
        "active",
        "suspended",
        "expired",
        "cancelled",
      ],
      default: "trial",
      index: true,
    },

    subscriptionPlan: {
      type: String,
      default: "trial",
    },

    subscriptionStart: {
      type: Date,
      default: Date.now,
    },

    subscriptionEnd: {
      type: Date,
      default: null,
    },

    features: {
      type: [String],
      default: [],
    },

    limits: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

schema.index({
  status: 1,
  subscriptionEnd: 1,
});

module.exports = mongoose.model("Tenant", schema);