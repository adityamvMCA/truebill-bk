const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, unique: true, index: true },
    businessName: { type: String, required: true, trim: true, maxlength: 200 },
    businessType: { type: String, default: "Trader" },
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    gstNo: { type: String, uppercase: true, trim: true },
    panNo: { type: String, uppercase: true, trim: true },
    address: String,
    city: String,
    state: String,
    pincode: String,
    status: {
      type: String,
      enum: ["trial", "active", "suspended", "expired", "cancelled"],
      default: "trial",
      index: true,
    },
    subscriptionPlan: { type: String, default: "trial" },
    subscriptionStart: { type: Date, default: Date.now },
    subscriptionEnd: { type: Date, default: null },
    features: { type: [String], default: [] },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);
module.exports = mongoose.model("Tenant", schema);
