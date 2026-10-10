const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    customerCode: {
      type: String,
      required: true,
      trim: true,
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    customerType: {
      type: String,
      enum: ["Business", "Individual"],
      default: "Business",
    },

    contactPerson: {
      type: String,
      default: null,
      trim: true,
    },

    phone: {
      type: String,
      default: null,
      trim: true,
    },

    alternatePhone: {
      type: String,
      default: null,
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    gstNo: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },

    panNo: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },

    billingAddress: {
      type: String,
      default: null,
      trim: true,
    },

    shippingAddress: {
      type: String,
      default: null,
      trim: true,
    },

    city: {
      type: String,
      default: null,
      trim: true,
    },

    state: {
      type: String,
      default: null,
      trim: true,
    },

    pincode: {
      type: String,
      default: null,
      trim: true,
    },

    country: {
      type: String,
      default: "India",
      trim: true,
    },

    paymentTerms: {
      type: String,
      default: "Due on Receipt",
      trim: true,
    },

    creditLimit: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Used by the future Sundry Debtors customer ledger.
      Example: 30 means payment expected within 30 days.
    */
    creditDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Opening balance when migrating an existing customer.
      For normal unpaid customer receivables, use DEBIT.
    */
    openingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    openingBalanceType: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      default: "DEBIT",
    },

    /*
      This is filled when we connect the customer
      to the AccountingLedger under Sundry Debtors.
    */
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
      index: true,
    },

    priceList: {
      type: String,
      default: "Standard",
      trim: true,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
      index: true,
    },

    notes: {
      type: String,
      default: null,
      trim: true,
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
  }
);

customerSchema.index(
  {
    tenantId: 1,
    customerCode: 1,
  },
  {
    unique: true,
  }
);

customerSchema.index({
  tenantId: 1,
  customerName: 1,
});

module.exports =
  mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);