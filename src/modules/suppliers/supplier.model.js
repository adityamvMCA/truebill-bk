const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    supplierCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    supplierName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    supplierType: {
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
      default: null,
      trim: true,
      lowercase: true,
    },

    gstNo: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },

    panNo: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
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

    creditDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Existing unpaid amount owed by the tenant
      to this supplier during migration.
    */
    openingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
      Normal supplier payable is CREDIT:
      the business owes the supplier.
    */
    openingBalanceType: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      default: "CREDIT",
    },

    /*
      Linked accounting ledger under Sundry Creditors.
    */
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
      index: true,
    },

    /*
      This will be updated later by:
      - Purchase Bills
      - Purchase Returns
      - Supplier Payments
      - Debit Notes
    */
    payableBalance: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
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
      maxlength: 500,
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

supplierSchema.index(
  {
    tenantId: 1,
    supplierCode: 1,
  },
  {
    unique: true,
  },
);

supplierSchema.index({
  tenantId: 1,
  supplierName: 1,
  isDeleted: 1,
});

module.exports =
  mongoose.models.Supplier || mongoose.model("Supplier", supplierSchema);
