const mongoose = require("mongoose");

const { Schema } = mongoose;

const productCategorySchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    categoryCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    name: {
      type: String,
      trim: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    normalizedName: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
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
      required: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    autoCreate: false,
    autoIndex: false,
  },
);

productCategorySchema.index(
  {
    tenantId: 1,
    categoryCode: 1,
  },
  {
    unique: true,
  },
);

productCategorySchema.index(
  {
    tenantId: 1,
    normalizedName: 1,
  },
  {
    unique: true,
  },
);

productCategorySchema.index({
  tenantId: 1,
  status: 1,
  name: 1,
  _id: 1,
});

module.exports =
  mongoose.models.ProductCategory ||
  mongoose.model("ProductCategory", productCategorySchema);
