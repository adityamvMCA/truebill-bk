const mongoose = require("mongoose");

const bankReconciliationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    reconciliationNumber: { type: String, required: true, uppercase: true },
    bankLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      required: true,
    },
    bankLedgerCode: { type: String, required: true },
    bankLedgerName: { type: String, required: true },
    statementDate: { type: Date, required: true },
    statementBalancePaise: { type: Number, required: true },
    bookBalancePaise: { type: Number, required: true },
    clearedBalancePaise: { type: Number, required: true },
    unclearedDebitPaise: { type: Number, default: 0 },
    unclearedCreditPaise: { type: Number, default: 0 },
    clearedCount: { type: Number, required: true },
    notes: { type: String, default: null },
    status: {
      type: String,
      enum: ["COMPLETED", "REVERSED"],
      default: "COMPLETED",
    },
    reversedAt: { type: Date, default: null },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "accounting_bank_reconciliations" },
);

bankReconciliationSchema.index(
  { tenantId: 1, reconciliationNumber: 1 },
  { unique: true },
);

bankReconciliationSchema.index({
  tenantId: 1,
  bankLedgerId: 1,
  status: 1,
  statementDate: -1,
});

module.exports =
  mongoose.models.BankReconciliation ||
  mongoose.model("BankReconciliation", bankReconciliationSchema);