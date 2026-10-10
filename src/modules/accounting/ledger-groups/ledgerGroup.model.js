const mongoose = require("mongoose");

const LEDGER_NATURES = [
  "ASSET",
  "LIABILITY",
  "INCOME",
  "EXPENSE",
  "EQUITY",
];

const ledgerGroupSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    nature: {
      type: String,
      required: true,
      enum: LEDGER_NATURES,
      index: true,
    },

    parentGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerGroup",
      default: null,
      index: true,
    },

    isPrimary: {
      type: Boolean,
      default: false,
    },

    isSystem: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    description: {
      type: String,
      default: null,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ledgerGroupSchema.index(
  {
    tenantId: 1,
    code: 1,
  },
  {
    unique: true,
  }
);

ledgerGroupSchema.index(
  {
    tenantId: 1,
    name: 1,
  },
  {
    unique: true,
  }
);

ledgerGroupSchema.statics.NATURES = LEDGER_NATURES;

module.exports = mongoose.model("LedgerGroup", ledgerGroupSchema);