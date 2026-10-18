const mongoose = require("mongoose");

const objectIdField = {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Ledger",
  default: null,
};

const taxConfigurationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    gstin: { type: String, default: null, trim: true, uppercase: true },
    stateCode: { type: String, default: null, trim: true },
    registrationType: {
      type: String,
      enum: ["REGULAR", "COMPOSITION", "UNREGISTERED"],
      default: "REGULAR",
    },
    defaultGstRate: {
      type: Number,
      enum: [0, 5, 12, 18, 28],
      default: 18,
    },
    outputCgstLedgerId: objectIdField,
    outputSgstLedgerId: objectIdField,
    outputIgstLedgerId: objectIdField,
    inputCgstLedgerId: objectIdField,
    inputSgstLedgerId: objectIdField,
    inputIgstLedgerId: objectIdField,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "accountingtaxconfigurations" },
);

// module.exports = taxConfigurationSchema;
module.exports =
  mongoose.models.TaxConfiguration ||
  mongoose.model("TaxConfiguration", taxConfigurationSchema);
