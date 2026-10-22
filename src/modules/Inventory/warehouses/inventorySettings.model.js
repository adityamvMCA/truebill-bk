const mongoose = require("mongoose");

const { Schema } = mongoose;

const inventorySettingsSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    defaultWarehouseId: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    multiWarehouseEnabled: {
      type: Boolean,
      default: false,
      required: true,
    },

    warehouseTrackingStatus: {
      type: String,
      enum: ["NOT_INITIALIZED", "READY"],
      default: "NOT_INITIALIZED",
      required: true,
    },

    warehouseTrackingStartedAt: {
      type: Date,
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

inventorySettingsSchema.index(
  {
    tenantId: 1,
  },
  {
    unique: true,
  },
);

inventorySettingsSchema.pre("validate", function () {
  if (this.multiWarehouseEnabled && this.warehouseTrackingStatus !== "READY") {
    this.invalidate(
      "multiWarehouseEnabled",
      "Warehouse stock must be initialized before enabling multiple warehouses",
    );
  }

  if (
    this.warehouseTrackingStatus === "READY" &&
    !this.warehouseTrackingStartedAt
  ) {
    this.invalidate(
      "warehouseTrackingStartedAt",
      "Warehouse tracking start time is required",
    );
  }
});

module.exports =
  mongoose.models.InventorySettings ||
  mongoose.model("InventorySettings", inventorySettingsSchema);
