const mongoose = require("mongoose");

const safeInt = {
  validator: Number.isSafeInteger,
  message: "{PATH} must be a safe integer",
};

const paiseField = (min = 0) => ({
  type: Number,
  required: true,
  min,
  default: min === 0 ? 0 : undefined,
  validate: safeInt,
});

const noteLineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 300 },
    hsnSac: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 8,
    },
    quantity: { type: Number, default: null, min: 0 },
    unit: { type: String, default: null, trim: true, maxlength: 20 },
    taxablePaise: paiseField(1),
    gstRate: { type: Number, required: true, min: 0, max: 28 },
    cgstPaise: paiseField(),
    sgstPaise: paiseField(),
    igstPaise: paiseField(),
    lineTotalPaise: paiseField(1),
  },
  { _id: false },
);

const REASONS = [
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "DAMAGED_GOODS",
  "QUANTITY_SHORTAGE",
  // Not tied to goods:
  "PRICE_ADJUSTMENT",
  "DISCOUNT",
  "RATE_DIFFERENCE",
  "TAX_CORRECTION",
  "OTHER",
];

const noteSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    noteNumber: { type: String, required: true, trim: true, uppercase: true },
    noteType: {
      type: String,
      enum: ["CREDIT_NOTE", "DEBIT_NOTE"],
      required: true,
    },
    partyType: { type: String, enum: ["CUSTOMER", "SUPPLIER"], required: true },

    partyId: { type: mongoose.Schema.Types.ObjectId, default: null },
    partyLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },
    partyName: { type: String, required: true, trim: true, maxlength: 200 },
    partyGstin: { type: String, default: null, trim: true, uppercase: true },

    // Sales Returns / Discounts, Purchase Returns / Adjustments, etc.
    adjustmentLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    noteDate: { type: Date, required: true },
    reason: { type: String, enum: REASONS, required: true },
    isGoodsRelated: { type: Boolean, required: true },
    isInterState: { type: Boolean, required: true, default: false },

    // GST needs the note to point at the original invoice / bill.
    originalDocType: {
      type: String,
      enum: ["SALES_INVOICE", "PURCHASE_BILL", null],
      default: null,
    },
    originalDocId: { type: mongoose.Schema.Types.ObjectId, default: null },
    originalDocNumber: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    originalDocDate: { type: Date, default: null },

    lines: {
      type: [noteLineSchema],
      validate: {
        validator: (l) => Array.isArray(l) && l.length >= 1,
        message: "At least one line is required",
      },
    },

    totalTaxablePaise: paiseField(1),
    totalCgstPaise: paiseField(),
    totalSgstPaise: paiseField(),
    totalIgstPaise: paiseField(),
    totalTaxPaise: paiseField(),
    totalAmountPaise: paiseField(1),

    narration: { type: String, default: null, trim: true, maxlength: 1000 },

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
    journalNumber: { type: String, required: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

noteSchema.index({ tenantId: 1, noteNumber: 1 }, { unique: true });
noteSchema.index({ tenantId: 1, noteDate: -1, createdAt: -1 });
noteSchema.index({ tenantId: 1, partyType: 1, noteType: 1, noteDate: -1 });
noteSchema.index({ tenantId: 1, originalDocType: 1, originalDocNumber: 1 });

noteSchema.pre("validate", function () {
  let taxable = 0,
    cgst = 0,
    sgst = 0,
    igst = 0;

  for (const l of this.lines || []) {
    const tax = l.cgstPaise + l.sgstPaise + l.igstPaise;
    if (l.lineTotalPaise !== l.taxablePaise + tax) {
      return this.invalidate(
        "lines",
        "Line total does not match taxable value plus tax",
      );
    }
    if (this.isInterState && (l.cgstPaise || l.sgstPaise)) {
      return this.invalidate("lines", "Inter-state notes can only carry IGST");
    }
    if (!this.isInterState && l.igstPaise) {
      return this.invalidate(
        "lines",
        "Intra-state notes can only carry CGST and SGST",
      );
    }
    taxable += l.taxablePaise;
    cgst += l.cgstPaise;
    sgst += l.sgstPaise;
    igst += l.igstPaise;
  }

  const tax = cgst + sgst + igst;
  if (
    this.totalTaxablePaise !== taxable ||
    this.totalCgstPaise !== cgst ||
    this.totalSgstPaise !== sgst ||
    this.totalIgstPaise !== igst ||
    this.totalTaxPaise !== tax ||
    this.totalAmountPaise !== taxable + tax
  ) {
    this.invalidate("lines", "Note totals do not match its lines");
  }
});

module.exports =
  mongoose.models.AccountingNote ||
  mongoose.model("AccountingNote", noteSchema);
module.exports.REASONS = REASONS;
