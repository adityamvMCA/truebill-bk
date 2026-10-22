const mongoose = require("mongoose");

const { Schema } = mongoose;

const isValidQuantity = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return false;
  }

  const scaled = value * 1000;
  const rounded = Math.round(scaled);

  return (
    Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) <= 0.000001
  );
};

const warehouseStockSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
      immutable: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      immutable: true,
    },

    currentStock: {
      type: Number,
      min: 0,
      default: 0,
      required: true,

      validate: {
        validator: isValidQuantity,
        message:
          "Warehouse stock must be non-negative, within the supported range, and have at most three decimal places",
      },
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    autoCreate: false,
    autoIndex: false,
  },
);

warehouseStockSchema.index(
  {
    tenantId: 1,
    warehouseId: 1,
    productId: 1,
  },
  {
    unique: true,
  },
);

warehouseStockSchema.index({
  tenantId: 1,
  productId: 1,
  warehouseId: 1,
});

module.exports =
  mongoose.models.WarehouseStock ||
  mongoose.model("WarehouseStock", warehouseStockSchema);
