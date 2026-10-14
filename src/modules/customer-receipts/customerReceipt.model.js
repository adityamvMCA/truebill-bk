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

const allocationSchema = new mongoose.Schema(
  {
    salesInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesInvoice",
      required: true,
    },

    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    amountPaise: integerPaise(),
  },
  { _id: false },
);

const customerReceiptSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    receiptNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    requestId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    requestHash: {
      type: String,
      required: true,
      select: false,
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
    },

    customerLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    receiptLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    receiptLedgerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    receiptLedgerName: {
      type: String,
      required: true,
      trim: true,
    },

    receiptLedgerType: {
      type: String,
      required: true,
      enum: ["CASH", "BANK"],
    },

    receiptDate: {
      type: Date,
      required: true,
    },

    receiptMethod: {
      type: String,
      required: true,
      enum: ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"],
    },

    referenceNumber: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },

    amountPaise: integerPaise(),

    allocations: {
      type: [allocationSchema],
      required: true,
      validate: {
        validator: (allocations) =>
          Array.isArray(allocations) &&
          allocations.length >= 1 &&
          allocations.length <= 200,
        message: "A receipt requires between 1 and 200 allocations",
      },
    },

    status: {
      type: String,
      enum: ["POSTED"],
      default: "POSTED",
      required: true,
    },

    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingJournal",
      required: true,
    },

    postedAt: {
      type: Date,
      required: true,
    },

    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
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
  },
);

customerReceiptSchema.index(
  { tenantId: 1, receiptNumber: 1 },
  { unique: true },
);

customerReceiptSchema.index(
  { tenantId: 1, requestId: 1 },
  { unique: true },
);

module.exports =
  mongoose.models.CustomerReceipt ||
  mongoose.model("CustomerReceipt", customerReceiptSchema);