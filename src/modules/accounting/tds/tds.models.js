const mongoose = require("mongoose");

const safeInt = {
  validator: Number.isSafeInteger,
  message: "{PATH} must be a safe integer",
};
const paise = (extra = {}) => ({
  type: Number,
  min: 0,
  default: 0,
  validate: safeInt,
  ...extra,
});

const DEDUCTEE_TYPES = ["INDIVIDUAL_HUF", "COMPANY", "FIRM", "OTHER"];

/* ---------- Nature of Payment (Tally: TDS Nature of Payment master) ---------- */
const rateSlabSchema = new mongoose.Schema(
  {
    deducteeType: {
      type: String,
      enum: [...DEDUCTEE_TYPES, "ALL"],
      required: true,
    },
    withPanPercent: { type: Number, required: true, min: 0, max: 100 },
    withoutPanPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const natureSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    section: { type: String, required: true, trim: true, uppercase: true },
    paymentCode: { type: String, default: null, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    rates: { type: [rateSlabSchema], validate: (r) => r.length >= 1 },
    singleThresholdPaise: paise(), // per-payment limit, 0 = none
    annualThresholdPaise: paise(), // aggregate limit per party per FY, 0 = none
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    // Duties & Taxes ledger (type TAX) that holds the liability. Required to post.
    tdsLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
natureSchema.index(
  { tenantId: 1, section: 1, effectiveFrom: 1 },
  { unique: true },
);

/* ---------- One row per deduction decision, including nil ones (threshold tracking) ---------- */
const deductionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    deductionNumber: { type: String, required: true, uppercase: true },
    financialYear: { type: String, required: true }, // "2026-27"
    deductionDate: { type: Date, required: true },

    partyLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },
    partyName: { type: String, required: true, trim: true },
    pan: { type: String, default: null, uppercase: true, trim: true },
    deducteeType: { type: String, enum: DEDUCTEE_TYPES, required: true },

    natureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingTdsNature",
      required: true,
    },
    section: { type: String, required: true },

    baseAmountPaise: paise({ required: true, min: 1 }), // this payment/bill
    taxableBasePaise: paise({ required: true }), // incl. catch-up when annual limit crossed
    ratePercent: { type: Number, required: true, min: 0, max: 100 },
    tdsPaise: paise({ required: true }),
    reason: {
      type: String,
      enum: ["DEDUCTED", "BELOW_THRESHOLD", "LOWER_RATE_CERTIFICATE"],
      required: true,
    },
    certificateNumber: { type: String, default: null, trim: true },

    sourceType: { type: String, required: true }, // TDS_DEDUCTION | EXPENSE | PURCHASE_BILL ...
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sourceNumber: { type: String, required: true },
    originalDocNumber: { type: String, default: null, trim: true },
    originalDocDate: { type: Date, default: null },

    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingJournal",
      default: null,
    },
    depositStatus: {
      type: String,
      enum: ["NOT_DUE", "PENDING", "DEPOSITED"],
      default: "PENDING",
    },
    challanId: { type: mongoose.Schema.Types.ObjectId, default: null },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
deductionSchema.index({ tenantId: 1, deductionNumber: 1 }, { unique: true });
deductionSchema.index(
  { tenantId: 1, sourceType: 1, sourceId: 1 },
  { unique: true },
);
deductionSchema.index({
  tenantId: 1,
  partyLedgerId: 1,
  natureId: 1,
  financialYear: 1,
});
deductionSchema.index({ tenantId: 1, deductionDate: -1 });

/* ---------- Challan (Tally: statutory payment voucher) ---------- */
const challanSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    challanNumber: { type: String, required: true, uppercase: true }, // our voucher no.
    bsrCode: { type: String, required: true, trim: true, match: /^\d{7}$/ },
    challanSerialNo: { type: String, required: true, trim: true },
    depositDate: { type: Date, required: true },
    bankLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },
    deductionIds: { type: [mongoose.Schema.Types.ObjectId], required: true },
    totalTdsPaise: paise({ required: true, min: 1 }),
    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingJournal",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
challanSchema.index({ tenantId: 1, challanNumber: 1 }, { unique: true });
challanSchema.index(
  { tenantId: 1, bsrCode: 1, challanSerialNo: 1, depositDate: 1 },
  { unique: true },
);

module.exports = {
  DEDUCTEE_TYPES,
  natureSchema,
  deductionSchema,
  challanSchema,
  TdsNature:
    mongoose.models.AccountingTdsNature ||
    mongoose.model("AccountingTdsNature", natureSchema),
  TdsDeduction:
    mongoose.models.AccountingTdsDeduction ||
    mongoose.model("AccountingTdsDeduction", deductionSchema),
  TdsChallan:
    mongoose.models.AccountingTdsChallan ||
    mongoose.model("AccountingTdsChallan", challanSchema),
};
