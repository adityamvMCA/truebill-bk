const mongoose = require("mongoose");

const integerPaise = (required = true) => ({
  type: Number,
  required,
  min: 0,
  validate: {
    validator: Number.isSafeInteger,
    message: "Amount must be a non-negative safe integer in paise",
  },
});

const itemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    productCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    productName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
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

    hsnSacCode: {
      type: String,
      default: null,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },

    unitRatePaise: integerPaise(),

    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    gstRate: {
      type: Number,
      required: true,
      enum: [0, 3, 5, 12, 18, 28],
    },

    salesLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    grossAmountPaise: integerPaise(),
    discountAmountPaise: integerPaise(),
    taxableAmountPaise: integerPaise(),

    cgstAmountPaise: integerPaise(),
    sgstAmountPaise: integerPaise(),
    igstAmountPaise: integerPaise(),

    totalAmountPaise: integerPaise(),
  },
  { _id: false },
);

const salesInvoiceSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    customerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    customerLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    customerGstNo: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },

    invoiceDate: {
      type: Date,
      required: true,
    },

    dueDate: {
      type: Date,
      required: true,
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },

    paymentTerms: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    taxMode: {
      type: String,
      enum: ["NONE", "INTRA_STATE", "INTER_STATE"],
      required: true,
    },

    updateStock: {
      type: Boolean,
      required: true,
      default: false,
    },

    items: {
      type: [itemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,
        message: "A sales invoice requires between 1 and 200 items",
      },
    },

    grossAmountPaise: integerPaise(),
    discountAmountPaise: integerPaise(),
    taxableAmountPaise: integerPaise(),

    cgstAmountPaise: integerPaise(),
    sgstAmountPaise: integerPaise(),
    igstAmountPaise: integerPaise(),

    totalAmountPaise: integerPaise(),
    paidAmountPaise: integerPaise(),
    outstandingAmountPaise: integerPaise(),

    status: {
      type: String,
      enum: ["DRAFT", "POSTED", "CANCELLED"],
      default: "DRAFT",
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIALLY_PAID", "PAID"],
      default: "UNPAID",
      required: true,
    },

    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingJournal",
      default: null,
    },

    postedAt: {
      type: Date,
      default: null,
    },

    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
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

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

salesInvoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });

salesInvoiceSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  invoiceDate: -1,
});

salesInvoiceSchema.index({
  tenantId: 1,
  customerId: 1,
  status: 1,
  dueDate: 1,
});

module.exports =
  mongoose.models.SalesInvoice ||
  mongoose.model("SalesInvoice", salesInvoiceSchema);
