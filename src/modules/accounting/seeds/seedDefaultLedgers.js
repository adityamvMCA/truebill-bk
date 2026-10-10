const Ledger = require("../ledgers/ledger.model");
const LedgerGroup = require("../ledger-groups/ledgerGroup.model");

const getNormalBalance = (nature) => {
  return ["ASSET", "EXPENSE"].includes(nature)
    ? "DEBIT"
    : "CREDIT";
};

const DEFAULT_LEDGERS = [
  {
    code: "CASH",
    name: "Cash",
    groupCode: "CASH_IN_HAND",
    type: "CASH",
    nature: "ASSET",
    description: "Main cash-in-hand account",
  },
  {
    code: "PETTY_CASH",
    name: "Petty Cash",
    groupCode: "CASH_IN_HAND",
    type: "CASH",
    nature: "ASSET",
    description: "Small daily operating cash account",
  },

  {
    code: "SALES",
    name: "Sales",
    groupCode: "SALES_ACCOUNTS",
    type: "SYSTEM",
    nature: "INCOME",
    description: "Primary sales revenue ledger",
  },
  {
    code: "SALES_RETURN",
    name: "Sales Return",
    groupCode: "SALES_ACCOUNTS",
    type: "SYSTEM",
    nature: "EXPENSE",
    description: "Sales return and credit-note adjustment ledger",
  },

  {
    code: "PURCHASE",
    name: "Purchase",
    groupCode: "PURCHASE_ACCOUNTS",
    type: "SYSTEM",
    nature: "EXPENSE",
    description: "Primary purchase ledger",
  },
  {
    code: "PURCHASE_RETURN",
    name: "Purchase Return",
    groupCode: "PURCHASE_ACCOUNTS",
    type: "SYSTEM",
    nature: "INCOME",
    description: "Purchase return and debit-note adjustment ledger",
  },

  {
    code: "INPUT_CGST",
    name: "Input CGST",
    groupCode: "DUTIES_TAXES_ASSET",
    type: "TAX",
    nature: "ASSET",
    description: "Input Central GST available for set-off",
  },
  {
    code: "INPUT_SGST",
    name: "Input SGST",
    groupCode: "DUTIES_TAXES_ASSET",
    type: "TAX",
    nature: "ASSET",
    description: "Input State GST available for set-off",
  },
  {
    code: "INPUT_IGST",
    name: "Input IGST",
    groupCode: "DUTIES_TAXES_ASSET",
    type: "TAX",
    nature: "ASSET",
    description: "Input Integrated GST available for set-off",
  },

  {
    code: "OUTPUT_CGST",
    name: "Output CGST",
    groupCode: "DUTIES_TAXES_LIABILITY",
    type: "TAX",
    nature: "LIABILITY",
    description: "Output Central GST payable",
  },
  {
    code: "OUTPUT_SGST",
    name: "Output SGST",
    groupCode: "DUTIES_TAXES_LIABILITY",
    type: "TAX",
    nature: "LIABILITY",
    description: "Output State GST payable",
  },
  {
    code: "OUTPUT_IGST",
    name: "Output IGST",
    groupCode: "DUTIES_TAXES_LIABILITY",
    type: "TAX",
    nature: "LIABILITY",
    description: "Output Integrated GST payable",
  },

  {
    code: "DISCOUNT_ALLOWED",
    name: "Discount Allowed",
    groupCode: "INDIRECT_EXPENSES",
    type: "SYSTEM",
    nature: "EXPENSE",
    description: "Discount given to customers",
  },
  {
    code: "DISCOUNT_RECEIVED",
    name: "Discount Received",
    groupCode: "INDIRECT_INCOMES",
    type: "SYSTEM",
    nature: "INCOME",
    description: "Discount received from suppliers",
  },
  {
    code: "ROUNDING_OFF",
    name: "Rounding Off",
    groupCode: "ROUNDING_OFF",
    type: "SYSTEM",
    nature: "EXPENSE",
    description: "Invoice rounding adjustment",
  },

  {
    code: "SALARY_EXPENSE",
    name: "Salary Expense",
    groupCode: "INDIRECT_EXPENSES",
    type: "SYSTEM",
    nature: "EXPENSE",
    description: "Employee salary expense",
  },
  {
    code: "SALARY_PAYABLE",
    name: "Salary Payable",
    groupCode: "SALARY_PAYABLE",
    type: "SYSTEM",
    nature: "LIABILITY",
    description: "Unpaid salary liability",
  },

  {
    code: "CUSTOMER_ADVANCE",
    name: "Customer Advance",
    groupCode: "CUSTOMER_ADVANCES",
    type: "SYSTEM",
    nature: "LIABILITY",
    description: "Customer advances received before sale",
  },
  {
    code: "SUPPLIER_ADVANCE",
    name: "Supplier Advance",
    groupCode: "LOANS_ADVANCES_ASSET",
    type: "SYSTEM",
    nature: "ASSET",
    description: "Advance paid to suppliers before purchase",
  },

  {
    code: "ELECTRICITY_EXPENSE",
    name: "Electricity Expense",
    groupCode: "INDIRECT_EXPENSES",
    type: "ACCOUNT",
    nature: "EXPENSE",
    description: "Electricity and utility expense",
  },
  {
    code: "RENT_EXPENSE",
    name: "Rent Expense",
    groupCode: "INDIRECT_EXPENSES",
    type: "ACCOUNT",
    nature: "EXPENSE",
    description: "Office, shop, warehouse, or premises rent",
  },
  {
    code: "INTERNET_EXPENSE",
    name: "Internet Expense",
    groupCode: "INDIRECT_EXPENSES",
    type: "ACCOUNT",
    nature: "EXPENSE",
    description: "Internet, mobile, and communication expense",
  },
  {
    code: "BANK_CHARGES",
    name: "Bank Charges",
    groupCode: "INDIRECT_EXPENSES",
    type: "ACCOUNT",
    nature: "EXPENSE",
    description: "Bank, payment gateway, and transaction charges",
  },

  {
    code: "INTEREST_RECEIVED",
    name: "Interest Received",
    groupCode: "INDIRECT_INCOMES",
    type: "ACCOUNT",
    nature: "INCOME",
    description: "Interest income",
  },
  {
    code: "INTEREST_PAID",
    name: "Interest Paid",
    groupCode: "INDIRECT_EXPENSES",
    type: "ACCOUNT",
    nature: "EXPENSE",
    description: "Interest paid on loans or delayed payments",
  },

  {
    code: "OWNER_CAPITAL",
    name: "Owner Capital",
    groupCode: "CAPITAL_ACCOUNT",
    type: "SYSTEM",
    nature: "EQUITY",
    description: "Owner capital introduced into business",
  },
  {
    code: "DRAWINGS",
    name: "Drawings",
    groupCode: "CAPITAL_ACCOUNT",
    type: "SYSTEM",
    nature: "EQUITY",
    description: "Owner withdrawals from business",
  },
  {
    code: "RETAINED_EARNINGS",
    name: "Retained Earnings",
    groupCode: "RESERVES_SURPLUS",
    type: "SYSTEM",
    nature: "EQUITY",
    description: "Accumulated profit/loss carried forward",
  },

  {
    code: "SUSPENSE",
    name: "Suspense Account",
    groupCode: "SUSPENSE_ACCOUNT",
    type: "SYSTEM",
    nature: "ASSET",
    description: "Temporary account awaiting clarification",
  },
];

const seedDefaultLedgers = async ({ tenantId, userId = null }) => {
  if (!tenantId) {
    throw new Error("tenantId is required to seed default ledgers");
  }

  const groups = await LedgerGroup.find({
    tenantId,
    isActive: true,
  })
    .select("_id code nature")
    .lean();

  const groupMap = new Map(
    groups.map((group) => [group.code, group])
  );

  const missingGroups = DEFAULT_LEDGERS
    .filter((ledger) => !groupMap.has(ledger.groupCode))
    .map((ledger) => ledger.groupCode);

  if (missingGroups.length) {
    throw new Error(
      `Required ledger groups are missing: ${[
        ...new Set(missingGroups),
      ].join(", ")}`
    );
  }

  const operations = DEFAULT_LEDGERS.map((ledger) => {
    const group = groupMap.get(ledger.groupCode);
    const normalBalance = getNormalBalance(ledger.nature);

    return {
      updateOne: {
        filter: {
          tenantId,
          code: ledger.code,
        },
        update: {
          $setOnInsert: {
            tenantId,
            ledgerGroupId: group._id,
            code: ledger.code,
            name: ledger.name,
            type: ledger.type,
            nature: ledger.nature,
            normalBalance,
            openingBalance: 0,
            openingBalanceType: normalBalance,
            currentBalance: 0,
            currentBalanceType: normalBalance,
            referenceType: null,
            referenceId: null,
            creditLimit: 0,
            creditDays: 0,
            isSystem: true,
            isActive: true,
            description: ledger.description,
            createdBy: userId,
            updatedBy: userId,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await Ledger.bulkWrite(operations, {
    ordered: false,
  });

  const ledgers = await Ledger.find({
    tenantId,
    isActive: true,
    isSystem: true,
  })
    .populate("ledgerGroupId", "code name nature")
    .sort({
      nature: 1,
      name: 1,
    })
    .lean();

  return {
    insertedCount: result.upsertedCount || 0,
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    totalLedgers: ledgers.length,
    ledgers,
  };
};

module.exports = {
  DEFAULT_LEDGERS,
  seedDefaultLedgers,
};