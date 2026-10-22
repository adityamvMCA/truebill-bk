const mongoose = require("mongoose");

const { Schema } = mongoose;

const productUnitSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    unitCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      match: /^[A-Z][A-Z0-9_]{0,19}$/,
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

    symbol: {
      type: String,
      trim: true,
      maxlength: 20,
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

productUnitSchema.index(
  {
    tenantId: 1,
    unitCode: 1,
  },
  {
    unique: true,
  },
);

productUnitSchema.index(
  {
    tenantId: 1,
    normalizedName: 1,
  },
  {
    unique: true,
  },
);

productUnitSchema.index({
  tenantId: 1,
  status: 1,
  name: 1,
  _id: 1,
});

module.exports =
  mongoose.models.ProductUnit ||
  mongoose.model("ProductUnit", productUnitSchema);
