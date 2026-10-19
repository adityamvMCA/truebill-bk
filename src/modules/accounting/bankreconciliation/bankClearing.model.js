const mongoose = require("mongoose");

const bankClearingSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    bankLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ledger",
      required: true,
    },
    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Journal",
      required: true,
    },
    lineIndex: { type: Number, required: true, min: 0 },
    postingDate: { type: Date, required: true },
    effectPaise: { type: Number, required: true },
    clearedDate: { type: Date, required: true },
    reconciliationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankReconciliation",
      default: null,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "accounting_bank_clearings" },
);

bankClearingSchema.index(
  { tenantId: 1, bankLedgerId: 1, journalId: 1, lineIndex: 1 },
  { unique: true },
);

bankClearingSchema.index({
  tenantId: 1,
  bankLedgerId: 1,
  reconciliationId: 1,
});

module.exports =
  mongoose.models.BankClearing ||
  mongoose.model("BankClearing", bankClearingSchema);