const mongoose = require("mongoose");

const { Schema } = mongoose;

const taxRateSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
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

    rate: {
      type: Number,
      min: 0,
      max: 100,
      required: true,
    },

    taxType: {
      type: String,
      enum: ["GST", "VAT", "CUSTOM"],
      default: "GST",
      required: true,
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

taxRateSchema.index(
  {
    tenantId: 1,
    taxType: 1,
    rate: 1,
  },
  {
    unique: true,
  },
);

taxRateSchema.index(
  {
    tenantId: 1,
    normalizedName: 1,
  },
  {
    unique: true,
  },
);

taxRateSchema.index({
  tenantId: 1,
  status: 1,
  taxType: 1,
  rate: 1,
  _id: 1,
});

module.exports =
  mongoose.models.TaxRate || mongoose.model("TaxRate", taxRateSchema);
