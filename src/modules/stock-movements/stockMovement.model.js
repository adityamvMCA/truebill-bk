const mongoose = require("mongoose");

const MOVEMENT_TYPES = [
  "OPENING",
  "PURCHASE",
  "PURCHASE_RETURN",
  "SALE",
  "DELIVERY",
  "SALES_RETURN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "GOODS_RECEIPT",
];
const DIRECTIONS = ["IN", "OUT"];

const stockMovementSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    productCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    movementType: {
      type: String,
      enum: MOVEMENT_TYPES,
      required: true,
      index: true,
    },

    direction: {
      type: String,
      enum: DIRECTIONS,
      required: true,
      index: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },

    unitRate: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalValue: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Product stock before and after this movement.
      These values make stock reports and audit checks fast.
    */
    stockBefore: {
      type: Number,
      required: true,
    },

    stockAfter: {
      type: Number,
      required: true,
    },

    /*
      Future source links:
      SALE            → SalesInvoice
      PURCHASE        → PurchaseBill
      SALES_RETURN    → SalesReturn
      PURCHASE_RETURN → PurchaseReturn
      ADJUSTMENT_*    → StockAdjustment
    */
    referenceType: {
      type: mongoose.Schema.Types.String,
      enum: [
        "OPENING",
        "SALES_INVOICE",
        "DELIVERY_NOTE",
        "PURCHASE_BILL",
        "SALES_RETURN",
        "PURCHASE_RETURN",
        "STOCK_ADJUSTMENT",
        "STOCK_TRANSFER",
        "GOODS_RECEIPT",
        null,
      ],
      default: null,
      index: true,
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    referenceNumber: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },

    movementDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    aggregateStockBefore: {
      type: Number,
      min: 0,
      default: null,
    },

    aggregateStockAfter: {
      type: Number,
      min: 0,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

stockMovementSchema.index({
  tenantId: 1,
  productId: 1,
  movementDate: -1,
  createdAt: -1,
});

stockMovementSchema.index({
  tenantId: 1,
  movementType: 1,
  movementDate: -1,
});
stockMovementSchema.index({
  tenantId: 1,
  warehouseId: 1,
  productId: 1,
  movementDate: -1,
  _id: -1,
});
stockMovementSchema.index(
  {
    tenantId: 1,
    productId: 1,
    movementType: 1,
    referenceType: 1,
    referenceId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      referenceId: {
        $type: "objectId",
      },
    },
  },
);

module.exports =
  mongoose.models.StockMovement ||
  mongoose.model("StockMovement", stockMovementSchema);
