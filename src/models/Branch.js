const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Branch name is required"],
      trim: true,
      maxlength: 120,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
      default: null,
    },
    isMain: {
      type: Boolean,
      default: false,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    gstNo: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    address: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      pincode: { type: String, trim: true, default: "" },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

branchSchema.index({ tenantId: 1, name: 1 });
branchSchema.index({ tenantId: 1, isActive: 1 });

module.exports = mongoose.model("Branch", branchSchema);
