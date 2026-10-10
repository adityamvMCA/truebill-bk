const LedgerGroup = require("../ledger-groups/ledgerGroup.model");

const DEFAULT_LEDGER_GROUPS = [
  {
    code: "CAPITAL_ACCOUNT",
    name: "Capital Account",
    nature: "EQUITY",
    isPrimary: true,
    description: "Owner capital, drawings, and proprietor accounts",
  },
  {
    code: "RESERVES_SURPLUS",
    name: "Reserves & Surplus",
    nature: "EQUITY",
    isPrimary: true,
    description: "Retained earnings and business reserves",
  },

  {
    code: "CURRENT_ASSETS",
    name: "Current Assets",
    nature: "ASSET",
    isPrimary: true,
    description:
      "Assets expected to be used, sold, or collected within one year",
  },
  {
    code: "CASH_IN_HAND",
    name: "Cash-in-Hand",
    nature: "ASSET",
    isPrimary: false,
    description: "Physical cash, petty cash, and cash counters",
  },
  {
    code: "BANK_ACCOUNTS",
    name: "Bank Accounts",
    nature: "ASSET",
    isPrimary: false,
    description: "Bank, UPI, card settlement, and payment gateway accounts",
  },
  {
    code: "SUNDRY_DEBTORS",
    name: "Sundry Debtors",
    nature: "ASSET",
    isPrimary: false,
    description: "Customers and parties from whom money is receivable",
  },
  {
    code: "LOANS_ADVANCES_ASSET",
    name: "Loans & Advances (Asset)",
    nature: "ASSET",
    isPrimary: false,
    description: "Recoverable staff advances, supplier advances, and deposits",
  },
  {
    code: "STOCK_IN_HAND",
    name: "Stock-in-Hand",
    nature: "ASSET",
    isPrimary: false,
    description: "Inventory and closing stock value",
  },
  {
    code: "DUTIES_TAXES_ASSET",
    name: "Duties & Taxes (Input)",
    nature: "ASSET",
    isPrimary: false,
    description: "Input GST, TDS receivable, and recoverable taxes",
  },
  {
    code: "FIXED_ASSETS",
    name: "Fixed Assets",
    nature: "ASSET",
    isPrimary: true,
    description:
      "Computers, furniture, vehicles, equipment, and other long-term assets",
  },
  {
    code: "INVESTMENTS",
    name: "Investments",
    nature: "ASSET",
    isPrimary: true,
    description: "Long-term and short-term investment accounts",
  },

  {
    code: "CURRENT_LIABILITIES",
    name: "Current Liabilities",
    nature: "LIABILITY",
    isPrimary: true,
    description: "Short-term obligations payable by the business",
  },
  {
    code: "SUNDRY_CREDITORS",
    name: "Sundry Creditors",
    nature: "LIABILITY",
    isPrimary: false,
    description: "Suppliers and vendors to whom money is payable",
  },
  {
    code: "DUTIES_TAXES_LIABILITY",
    name: "Duties & Taxes (Output)",
    nature: "LIABILITY",
    isPrimary: false,
    description: "Output GST, TDS payable, and statutory tax liabilities",
  },
  {
    code: "SALARY_PAYABLE",
    name: "Salary Payable",
    nature: "LIABILITY",
    isPrimary: false,
    description: "Unpaid employee salaries and payroll liabilities",
  },
  {
    code: "CUSTOMER_ADVANCES",
    name: "Customer Advances",
    nature: "LIABILITY",
    isPrimary: false,
    description: "Advance collections received from customers",
  },
  {
    code: "SECURED_LOANS",
    name: "Secured Loans",
    nature: "LIABILITY",
    isPrimary: true,
    description: "Loans secured against assets",
  },
  {
    code: "UNSECURED_LOANS",
    name: "Unsecured Loans",
    nature: "LIABILITY",
    isPrimary: true,
    description: "Owner loans, director loans, and unsecured borrowings",
  },

  {
    code: "SALES_ACCOUNTS",
    name: "Sales Accounts",
    nature: "INCOME",
    isPrimary: true,
    description: "Sales revenue and service income",
  },
  {
    code: "DIRECT_INCOMES",
    name: "Direct Incomes",
    nature: "INCOME",
    isPrimary: true,
    description: "Income directly related to core operations",
  },
  {
    code: "INDIRECT_INCOMES",
    name: "Indirect Incomes",
    nature: "INCOME",
    isPrimary: true,
    description: "Interest, discounts received, and other incidental income",
  },

  {
    code: "PURCHASE_ACCOUNTS",
    name: "Purchase Accounts",
    nature: "EXPENSE",
    isPrimary: true,
    description: "Purchase of goods, materials, and stock",
  },
  {
    code: "DIRECT_EXPENSES",
    name: "Direct Expenses",
    nature: "EXPENSE",
    isPrimary: true,
    description:
      "Expenses directly related to procurement, production, or service delivery",
  },
  {
    code: "INDIRECT_EXPENSES",
    name: "Indirect Expenses",
    nature: "EXPENSE",
    isPrimary: true,
    description:
      "Administrative and operating expenses such as rent, electricity, salary, and internet",
  },

  {
    code: "SUSPENSE_ACCOUNT",
    name: "Suspense Account",
    nature: "ASSET",
    isPrimary: true,
    description: "Temporary account for entries awaiting clarification",
  },
  {
    code: "ROUNDING_OFF",
    name: "Rounding Off",
    nature: "EXPENSE",
    isPrimary: true,
    description: "Rounding difference adjustment account",
  },
];

const seedDefaultLedgerGroups = async ({ tenantId, userId = null }) => {
  if (!tenantId) {
    throw new Error("tenantId is required to seed ledger groups");
  }

  const operations = DEFAULT_LEDGER_GROUPS.map((group) => ({
    updateOne: {
      filter: {
        tenantId,
        code: group.code,
      },
      update: {
        $setOnInsert: {
          tenantId,
          ...group,
          isSystem: true,
          isActive: true,
          createdBy: userId,
          updatedBy: userId,
        },
      },
      upsert: true,
    },
  }));

  const result = await LedgerGroup.bulkWrite(operations, {
    ordered: false,
  });

  const groups = await LedgerGroup.find({
    tenantId,
    isActive: true,
  })
    .sort({ nature: 1, name: 1 })
    .lean();

  return {
    insertedCount: result.upsertedCount || 0,
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    totalGroups: groups.length,
    groups,
  };
};

module.exports = {
  DEFAULT_LEDGER_GROUPS,
  seedDefaultLedgerGroups,
};
