const mongoose = require("mongoose");

const { Schema } = mongoose;

const optionalText = (maxlength) => ({
  type: String,
  trim: true,
  maxlength,
  default: null,
});

const quantityIsValid = (value) =>
  Number.isFinite(value) &&
  Number.isSafeInteger(Math.round(value * 1000)) &&
  Math.abs(value * 1000 - Math.round(value * 1000)) <= 0.000001;

const itemSchema = new Schema(
  {
    lineId: {
      type: Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
    },

    orderLineId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    productCode: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },

    productName: {
      type: String,
      trim: true,
      maxlength: 200,
      required: true,
    },

    productType: {
      type: String,
      enum: ["GOODS", "SERVICE"],
      required: true,
    },

    trackInventory: {
      type: Boolean,
      required: true,
    },

    unit: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      min: 0.001,
      max: 1000000,
      required: true,

      validate: {
        validator: quantityIsValid,
        message: "Quantity must have at most three decimals",
      },
    },

    // Provisional, tax-exclusive receipt rate.
    // This does not post inventory valuation journals.
    estimatedUnitRatePaise: {
      type: Number,
      min: 0,
      max: 100000000000,
      required: true,

      validate: {
        validator: Number.isSafeInteger,
        message: "Estimated unit rate must be safe integer paise",
      },
    },

    notes: optionalText(500),
  },
  { _id: false },
);

const goodsReceiptSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    receiptNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    // Client-generated key for retry protection.
    requestId: {
      type: String,
      trim: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    requestHash: {
      type: String,
      required: true,
      immutable: true,
    },

    creationMode: {
      type: String,
      enum: ["DIRECT", "PURCHASE_ORDER"],
      required: true,
      immutable: true,
    },

    receiptDate: {
      type: Date,
      required: true,
    },

    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      immutable: true,
    },

    supplierCode: {
      type: String,
      trim: true,
      required: true,
    },

    supplierName: {
      type: String,
      trim: true,
      required: true,
    },

    sourceOrderId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "PURCHASE_ORDER";
      },
    },

    sourceOrderNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "PURCHASE_ORDER";
      },
    },

    supplierDeliveryReference: optionalText(100),

    items: {
      type: [itemSchema],
      required: true,

      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,

        message: "Provide between 1 and 200 receipt items",
      },
    },

    stockMovementIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "StockMovement",
      },
    ],

    status: {
      type: String,
      enum: ["CREATED"],
      default: "CREATED",
      required: true,
    },

    notes: optionalText(2000),

    createdBy: {
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

goodsReceiptSchema.index({ tenantId: 1, receiptNumber: 1 }, { unique: true });

goodsReceiptSchema.index({ tenantId: 1, requestId: 1 }, { unique: true });

goodsReceiptSchema.index({
  tenantId: 1,
  sourceOrderId: 1,
});

goodsReceiptSchema.index({
  tenantId: 1,
  receiptDate: -1,
  _id: -1,
});

goodsReceiptSchema.pre("validate", function () {
  if (
    this.creationMode === "DIRECT" &&
    (this.sourceOrderId != null || this.sourceOrderNumber != null)
  ) {
    this.invalidate(
      "sourceOrderId",
      "DIRECT receipts cannot reference a Purchase Order",
    );
  }

  const seenLines = new Set();
  const seenOrderLines = new Set();

  for (const [index, item] of (this.items || []).entries()) {
    const key = String(item.lineId);

    if (seenLines.has(key)) {
      this.invalidate(`items.${index}.lineId`, "Receipt lineId must be unique");
    }

    seenLines.add(key);

    if (item.productType === "SERVICE" && item.trackInventory) {
      this.invalidate(
        `items.${index}.trackInventory`,
        "Services cannot track inventory",
      );
    }

    if (this.creationMode === "DIRECT" && item.orderLineId != null) {
      this.invalidate(
        `items.${index}.orderLineId`,
        "DIRECT receipt items cannot reference order lines",
      );
    }

    if (this.creationMode === "PURCHASE_ORDER") {
      if (!item.orderLineId) {
        this.invalidate(
          `items.${index}.orderLineId`,
          "Order line reference is required",
        );
      } else {
        const sourceKey = String(item.orderLineId);

        if (seenOrderLines.has(sourceKey)) {
          this.invalidate(
            `items.${index}.orderLineId`,
            "An order line cannot appear twice in a receipt",
          );
        }

        seenOrderLines.add(sourceKey);
      }
    }
  }
});

module.exports =
  mongoose.models.GoodsReceipt ||
  mongoose.model("GoodsReceipt", goodsReceiptSchema);
