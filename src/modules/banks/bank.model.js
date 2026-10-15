const mongoose = require("mongoose");

const bankSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    bankCode: { type: String, required: true, trim: true, uppercase: true },
    accountName: { type: String, required: true, trim: true, maxlength: 150 },
    bankName: { type: String, required: true, trim: true, maxlength: 150 },
    accountHolderName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    accountNumber: { type: String, required: true, trim: true, maxlength: 40 },
    accountType: { type: String, enum: ["CURRENT", "SAVINGS"], required: true },
    branchName: { type: String, required: true, trim: true, maxlength: 150 },
    ifscCode: { type: String, required: true, trim: true, uppercase: true },
    currency: { type: String, enum: ["INR"], default: "INR", required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
      required: true,
    },
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },
    notes: { type: String, default: null, trim: true, maxlength: 1000 },
    isDeleted: { type: Boolean, default: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

bankSchema.index({ tenantId: 1, bankCode: 1 }, { unique: true });
bankSchema.index(
  { tenantId: 1, bankName: 1, accountNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
bankSchema.index({ tenantId: 1, isDeleted: 1, status: 1 });

module.exports = mongoose.models.Bank || mongoose.model("Bank", bankSchema);
