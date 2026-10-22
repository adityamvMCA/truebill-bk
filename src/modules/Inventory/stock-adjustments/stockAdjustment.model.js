const mongoose = require("mongoose");

const { Schema } = mongoose;

const stockAdjustmentSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    adjustmentNumber: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      immutable: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      immutable: true,
    },

    productCode: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      immutable: true,
    },

    adjustmentType: {
      type: String,
      enum: ["INCREASE", "DECREASE"],
      required: true,
      immutable: true,
    },

    quantity: {
      type: Number,
      min: 0.001,
      max: 1000000,
      required: true,
      immutable: true,
    },

    unitRate: {
      type: Number,
      min: 0,
      max: 1000000000,
      default: 0,
      required: true,
      immutable: true,
    },

    totalValue: {
      type: Number,
      min: 0,
      max: 1000000000,
      default: 0,
      required: true,
      immutable: true,
    },

    stockBefore: {
      type: Number,
      min: 0,
      max: 1000000,
      required: true,
      immutable: true,
    },

    stockAfter: {
      type: Number,
      min: 0,
      max: 1000000,
      required: true,
      immutable: true,
    },

    reason: {
      type: String,
      enum: [
        "PHYSICAL_COUNT",
        "DAMAGE",
        "THEFT",
        "EXPIRY",
        "CORRECTION",
        "OTHER",
      ],
      required: true,
      immutable: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    adjustmentDate: {
      type: Date,
      default: Date.now,
      required: true,
      immutable: true,
    },

    status: {
      type: String,
      enum: ["COMPLETED"],
      default: "COMPLETED",
      required: true,
      immutable: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    autoCreate: false,
    autoIndex: false,
  },
);

stockAdjustmentSchema.index(
  {
    tenantId: 1,
    adjustmentNumber: 1,
  },
  {
    unique: true,
  },
);

stockAdjustmentSchema.index({
  tenantId: 1,
  productId: 1,
  adjustmentDate: -1,
  _id: -1,
});

stockAdjustmentSchema.index({
  tenantId: 1,
  reason: 1,
  adjustmentDate: -1,
});

module.exports =
  mongoose.models.StockAdjustment ||
  mongoose.model("StockAdjustment", stockAdjustmentSchema);
