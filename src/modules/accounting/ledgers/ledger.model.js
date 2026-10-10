const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    ledgerGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerGroup",
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

    /*
      ACCOUNT = normal ledger such as Cash, Sales, Electricity
      CUSTOMER = party ledger under Sundry Debtors
      SUPPLIER = party ledger under Sundry Creditors
      BANK = bank ledger under Bank Accounts
      TAX = GST/TDS ledgers
      SYSTEM = core protected accounts created by the seed
    */
    type: {
      type: String,
      enum: [
        "ACCOUNT",
        "CUSTOMER",
        "SUPPLIER",
        "BANK",
        "CASH",
        "TAX",
        "SYSTEM",
      ],
      default: "ACCOUNT",
      index: true,
    },

    nature: {
      type: String,
      enum: [
        "ASSET",
        "LIABILITY",
        "INCOME",
        "EXPENSE",
        "EQUITY",
      ],
      required: true,
      index: true,
    },

    /*
      Normal balance direction:
      Debit: Assets, Expenses
      Credit: Liabilities, Income, Equity
    */
    normalBalance: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },

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

    currentBalance: {
      type: Number,
      default: 0,
    },

    currentBalanceType: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      default: "DEBIT",
    },

    /*
      For Customer and Supplier ledger integration.
      Later:
      CUSTOMER → existing customer _id
      SUPPLIER → existing vendor/supplier _id
      BANK → bank account document _id
    */
    referenceType: {
      type: String,
      enum: ["CUSTOMER", "SUPPLIER", "BANK", "EMPLOYEE", null],
      default: null,
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
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

    isSystem: {
      type: Boolean,
      default: false,
      index: true,
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

ledgerSchema.index(
  {
    tenantId: 1,
    code: 1,
  },
  {
    unique: true,
  }
);

ledgerSchema.index(
  {
    tenantId: 1,
    name: 1,
  },
  {
    unique: true,
  }
);

ledgerSchema.index(
  {
    tenantId: 1,
    referenceType: 1,
    referenceId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      referenceId: {
        $type: "objectId",
      },
    },
  }
);

// module.exports = mongoose.model("Ledger", ledgerSchema);
module.exports =
  mongoose.models.AccountingLedger ||
  mongoose.model("AccountingLedger", ledgerSchema);