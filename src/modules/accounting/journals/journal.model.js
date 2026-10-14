const mongoose = require("mongoose");

const journalLineSchema = new mongoose.Schema(
  {
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    ledgerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    ledgerName: {
      type: String,
      required: true,
      trim: true,
    },

    debitPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "debitPaise must be a safe integer",
      },
    },

    creditPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "creditPaise must be a safe integer",
      },
    },

    narration: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
  },
  { _id: false },
);

const journalSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    journalNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    postingDate: {
      type: Date,
      required: true,
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },

    sourceType: {
      type: String,
      enum: ["PURCHASE_BILL"],
      required: true,
    },

    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    sourceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    eventType: {
      type: String,
      enum: ["POST"],
      default: "POST",
      required: true,
    },

    lines: {
      type: [journalLineSchema],
      required: true,
      validate: {
        validator: (lines) => Array.isArray(lines) && lines.length >= 2,
        message: "A journal requires at least two lines",
      },
    },

    totalDebitPaise: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "totalDebitPaise must be a safe integer",
      },
    },

    totalCreditPaise: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "totalCreditPaise must be a safe integer",
      },
    },

    narration: {
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
  },
  {
    timestamps: true,
  },
);

journalSchema.index(
  { tenantId: 1, journalNumber: 1 },
  { unique: true },
);

// Prevent posting the same purchase bill twice.
journalSchema.index(
  {
    tenantId: 1,
    sourceType: 1,
    sourceId: 1,
    eventType: 1,
  },
  { unique: true },
);

journalSchema.index({
  tenantId: 1,
  postingDate: -1,
  createdAt: -1,
});

journalSchema.index({
  tenantId: 1,
  "lines.ledgerId": 1,
  postingDate: -1,
});

journalSchema.pre("validate", function () {
  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of this.lines || []) {
    const debit = line.debitPaise;
    const credit = line.creditPaise;

    if (
      !Number.isSafeInteger(debit) ||
      !Number.isSafeInteger(credit) ||
      debit < 0 ||
      credit < 0
    ) {
      this.invalidate("lines", "Journal amounts must be non-negative integers");
      return;
    }

    if (!((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) {
      this.invalidate(
        "lines",
        "Each journal line must contain either a debit or a credit",
      );
      return;
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  if (
    !Number.isSafeInteger(totalDebit) ||
    !Number.isSafeInteger(totalCredit) ||
    totalDebit <= 0 ||
    totalDebit !== totalCredit
  ) {
    this.invalidate("lines", "Total debits must equal total credits");
    return;
  }

  if (
    this.totalDebitPaise !== totalDebit ||
    this.totalCreditPaise !== totalCredit
  ) {
    this.invalidate("lines", "Journal totals do not match its lines");
  }
});

module.exports =
  mongoose.models.AccountingJournal ||
  mongoose.model("AccountingJournal", journalSchema);