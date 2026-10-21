const mongoose = require("mongoose");

const PurchaseBill = require("../purchase-bills/purchaseBill.model");

const { Schema } = mongoose;

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

const paise = () => ({
  type: Number,
  min: 0,
  required: true,

  validate: {
    validator: Number.isSafeInteger,
    message: "Amount must be non-negative safe integer paise",
  },
});

const itemSchema = PurchaseBill.schema.path("items").schema.clone();

itemSchema.add({
  stockReturned: {
    type: Boolean,
    required: true,
  },
});

const purchaseReturnSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    returnNumber: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
      immutable: true,
    },

    requestId: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      immutable: true,
    },

    requestHash: {
      type: String,
      required: true,
      select: false,
      immutable: true,
    },

    purchaseBillId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseBill",
      required: true,
      immutable: true,
    },

    billNumber: {
      type: String,
      required: true,
      immutable: true,
    },

    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      immutable: true,
    },

    supplierCode: {
      type: String,
      required: true,
    },

    supplierName: {
      type: String,
      required: true,
    },

    supplierLedgerId: {
      type: Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    returnDate: {
      type: Date,
      required: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 1000,
      required: true,
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },

    taxMode: {
      type: String,
      enum: ["NONE", "INTRASTATE", "INTERSTATE"],
      required: true,
    },

    items: {
      type: [itemSchema],
      required: true,

      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,

        message: "Provide between 1 and 200 return items",
      },
    },

    ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, paise()])),

    stockMovementIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "StockMovement",
      },
    ],

    status: {
      type: String,
      enum: ["CREATED", "POSTED"],
      default: "CREATED",
      required: true,
    },

    journalId: {
      type: Schema.Types.ObjectId,
      ref: "AccountingJournal",
      default: null,
    },

    postedAt: {
      type: Date,
      default: null,
    },

    postedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

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

purchaseReturnSchema.index({ tenantId: 1, returnNumber: 1 }, { unique: true });

purchaseReturnSchema.index({ tenantId: 1, requestId: 1 }, { unique: true });

purchaseReturnSchema.index({
  tenantId: 1,
  purchaseBillId: 1,
  status: 1,
});

purchaseReturnSchema.index({
  tenantId: 1,
  returnDate: -1,
  _id: -1,
});

purchaseReturnSchema.pre("validate", function () {
  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const seen = new Set();

  for (const item of this.items || []) {
    const key = String(item.productId);

    if (seen.has(key)) {
      this.invalidate("items", "A product cannot appear twice");
    }

    seen.add(key);

    const tax =
      item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise;

    if (
      item.grossAmountPaise !==
        item.taxableAmountPaise + item.discountAmountPaise ||
      item.totalAmountPaise !== item.taxableAmountPaise + tax
    ) {
      this.invalidate("items", "Inconsistent return item amounts");
    }

    if (
      item.stockReturned &&
      (item.productType !== "GOODS" || !item.trackInventory)
    ) {
      this.invalidate("items", "Invalid stock-return item");
    }

    for (const field of AMOUNT_FIELDS) {
      totals[field] += item[field];
    }
  }

  for (const field of AMOUNT_FIELDS) {
    if (!Number.isSafeInteger(totals[field]) || totals[field] !== this[field]) {
      this.invalidate(field, "Return total does not match item totals");
    }
  }

  if (
    this.status === "POSTED" &&
    (!this.journalId || !this.postedAt || !this.postedBy)
  ) {
    this.invalidate("status", "Posting details are required");
  }
});

module.exports =
  mongoose.models.PurchaseReturn ||
  mongoose.model("PurchaseReturn", purchaseReturnSchema);
