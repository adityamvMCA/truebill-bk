const mongoose = require("mongoose");

const PRODUCT_TYPES = ["GOODS", "SERVICE"];

const PRODUCT_STATUS = ["ACTIVE", "INACTIVE"];

const UNITS = [
  "NOS",
  "PCS",
  "BOX",
  "BAG",
  "PACK",
  "SET",
  "KG",
  "GRAM",
  "TON",
  "LITRE",
  "ML",
  "METER",
  "FEET",
  "SQFT",
  "SQM",
  "HOUR",
  "DAY",
  "MONTH",
];

const GST_RATES = [0, 3, 5, 12, 18, 28];

const productSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    productCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    type: {
      type: String,
      enum: PRODUCT_TYPES,
      default: "GOODS",
      required: true,
      index: true,
    },

    category: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
      index: true,
    },

    brand: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },

    unit: {
      type: String,
      enum: UNITS,
      default: "NOS",
      required: true,
    },

    hsnSacCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },

    gstRate: {
      type: Number,
      enum: GST_RATES,
      default: 18,
    },

    salePrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    purchasePrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    trackInventory: {
      type: Boolean,
      default: true,
      index: true,
    },

    openingStock: {
      type: Number,
      default: 0,
      min: 0,
    },

    openingStockRate: {
      type: Number,
      default: 0,
      min: 0,
    },

    currentStock: {
      type: Number,
      default: 0,
    },

    reorderLevel: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Reserved for future accounting/inventory integration.
      Product creation does not create a separate ledger.
    */
    salesLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
      index: true,
    },

    purchaseLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
      index: true,
    },

    inventoryLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: PRODUCT_STATUS,
      default: "ACTIVE",
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

productSchema.index(
  {
    tenantId: 1,
    productCode: 1,
  },
  {
    unique: true,
  },
);

productSchema.index(
  {
    tenantId: 1,
    name: 1,
  },
  {
    unique: true,
  },
);

productSchema.index({
  tenantId: 1,
  category: 1,
  status: 1,
});

module.exports =
  mongoose.models.Product || mongoose.model("Product", productSchema);
