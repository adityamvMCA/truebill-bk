const mongoose = require("mongoose");

const { Schema } = mongoose;

const warehouseSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    warehouseCode: {
      type: String,
      trim: true,
      uppercase: true,
      match: /^[A-Z][A-Z0-9_]{0,19}$/,
      maxlength: 20,
      required: true,
      immutable: true,
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100,
      required: true,
    },

    normalizedName: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 100,
      required: true,
    },

    address: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
      required: true,
    },

    isSystem: {
      type: Boolean,
      default: false,
      required: true,
      immutable: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    autoCreate: false,
    autoIndex: false,
  },
);

warehouseSchema.index(
  {
    tenantId: 1,
    warehouseCode: 1,
  },
  {
    unique: true,
  },
);

warehouseSchema.index(
  {
    tenantId: 1,
    normalizedName: 1,
  },
  {
    unique: true,
  },
);

warehouseSchema.index({
  tenantId: 1,
  status: 1,
  name: 1,
  _id: 1,
});

module.exports =
  mongoose.models.Warehouse || warehouseSchema.index({ tenantId: 1, warehouseCode: 1, _id: 1 });
warehouseSchema.index({ tenantId: 1, createdAt: 1, _id: 1 });
warehouseSchema.index({ tenantId: 1, updatedAt: 1, _id: 1 });

module.exports =
  mongoose.models.Warehouse || mongoose.model("Warehouse", warehouseSchema);
