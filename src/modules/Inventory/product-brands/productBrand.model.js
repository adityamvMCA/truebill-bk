const mongoose = require("mongoose");

const { Schema } = mongoose;

const productBrandSchema = new Schema(
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

productBrandSchema.index(
  {
    tenantId: 1,
    normalizedName: 1,
  },
  {
    unique: true,
  },
);

productBrandSchema.index({
  tenantId: 1,
  status: 1,
  name: 1,
  _id: 1,
});

module.exports =
  mongoose.models.ProductBrand ||
  mongoose.model("ProductBrand", productBrandSchema);
