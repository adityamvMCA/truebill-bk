const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    // Indexed through compound indexes below
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
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

    contactPerson: { type: String, default: null, trim: true },
    phone: { type: String, default: null, trim: true },
    alternatePhone: { type: String, default: null, trim: true },

    email: { type: String, lowercase: true, trim: true, default: null },
    gstNo: { type: String, uppercase: true, trim: true, default: null },
    panNo: { type: String, uppercase: true, trim: true, default: null },

    billingAddress: { type: String, default: null, trim: true },
    shippingAddress: { type: String, default: null, trim: true },
    city: { type: String, default: null, trim: true },
    state: { type: String, default: null, trim: true },
    pincode: { type: String, default: null, trim: true },
    country: { type: String, default: "India", trim: true },

    paymentTerms: { type: String, default: "Due on Receipt", trim: true },

    creditLimit: { type: Number, default: 0, min: 0 },

    // Example: 30 means payment expected within 30 days.
    creditDays: { type: Number, default: 0, min: 0 },

    // Opening balance when migrating an existing customer.
    openingBalance: { type: Number, default: 0, min: 0 },

    openingBalanceType: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      default: "DEBIT",
    },

    // Linked AccountingLedger under Sundry Debtors.
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
    },

    priceList: { type: String, default: "Standard", trim: true },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },

    notes: { type: String, default: null, trim: true },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    receivableBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

/* ------------------------------------------------------------------ */
/* Indexes (every list query is tenant-scoped, so tenantId goes first) */
/* ------------------------------------------------------------------ */

// Uniqueness + customerCode sort / prefix search
customerSchema.index({ tenantId: 1, customerCode: 1 }, { unique: true });

// Default list: not deleted, newest first
customerSchema.index({ tenantId: 1, isDeleted: 1, createdAt: -1, _id: -1 });

// Sort by name
customerSchema.index({ tenantId: 1, isDeleted: 1, customerName: 1, _id: 1 });

// Status / type quick filters (+ default sort)
customerSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  createdAt: -1,
});
customerSchema.index({
  tenantId: 1,
  isDeleted: 1,
  customerType: 1,
  createdAt: -1,
});

// Lookup by linked ledger (posting / receipts)
customerSchema.index({ tenantId: 1, ledgerId: 1 }, { sparse: true });

// "Customers with outstanding balance" reports
customerSchema.index({ tenantId: 1, isDeleted: 1, receivableBalance: -1 });

// Prefix searches
customerSchema.index({ tenantId: 1, phone: 1 }, { sparse: true });
customerSchema.index({ tenantId: 1, gstNo: 1 }, { sparse: true });
customerSchema.index({ tenantId: 1, email: 1 }, { sparse: true });

module.exports =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);