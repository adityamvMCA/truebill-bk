const mongoose = require("mongoose");

const { getNextSequence } = require("../../utils/sequenceGenerator");
const {
  createBulkImportHandler,
} = require("../../utils/createBulkImportHandler");
const { createCustomerSchema } = require("./customer.validation");

const NORMAL_BALANCE_BY_NATURE = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  INCOME: "CREDIT",
  EQUITY: "CREDIT",
};

const titleCase = (value) =>
  typeof value === "string" && value
    ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
    : value;

// Reserves `count` customer codes, 50 at a time in parallel
const reserveCustomerCodes = async ({ count, tenant, connection }) => {
  const codes = [];
  const PARALLEL = 50;

  for (let i = 0; i < count; i += PARALLEL) {
    const size = Math.min(PARALLEL, count - i);

    const part = await Promise.all(
      Array.from({ length: size }, () =>
        // ASSUMPTION: same prefix and digits as your createCustomer
        getNextSequence("CU", tenant._id.toString(), 3, { connection }),
      ),
    );

    codes.push(...part);
  }

  return codes.sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true }),
  );
};

const importCustomers = createBulkImportHandler({
  label: "customer",
  modelKey: "Customer",
  maxRecords: 5000,
  chunkSize: 500,
  schema: createCustomerSchema,
  uniqueFields: ["gstNo"],
  baseFilter: { isDeleted: false },

  /*
    Ledger names are unique per tenant and shared by customers, suppliers
    and other accounts. Checking here reports a clash on the exact row
    instead of failing the whole chunk with E11000.
  */
  externalUniques: [
    {
      modelKey: "Ledger",
      field: "name",
      label: "ledger name",
      getValue: (data) => data.customerName,
      hint: "ledger names are shared with suppliers and other accounts",
    },
  ],

  transformRow: (row) => ({
    ...row,
    customerType: titleCase(row.customerType),
    status: titleCase(row.status),
    openingBalanceType:
      typeof row.openingBalanceType === "string"
        ? row.openingBalanceType.toUpperCase()
        : row.openingBalanceType,
  }),

  // Runs once per request, not once per customer
  prepare: async ({ models, tenantId }) => {
    // ASSUMPTION: your receivables group code
    const group = await models.LedgerGroup.findOne({
      tenantId,
      code: "SUNDRY_DEBTORS",
      isActive: true,
    }).lean();

    if (!group) {
      const error = new Error(
        "Sundry Debtors ledger group is missing. Seed accounting groups before importing customers.",
      );
      error.statusCode = 400;
      throw error;
    }

    const normalBalance = NORMAL_BALANCE_BY_NATURE[group.nature];

    if (!normalBalance) {
      const error = new Error(
        "Sundry Debtors ledger group has an invalid account nature.",
      );
      error.statusCode = 400;
      throw error;
    }

    return { group, normalBalance };
  },

  reserveCodes: reserveCustomerCodes,

  buildChunk: ({ items, ctx, models, tenantId, userId, ipAddress }) => {
    const customers = [];
    const ledgers = [];
    const audits = [];

    for (const item of items) {
      const data = item.data;

      const customerId = new mongoose.Types.ObjectId();
      const ledgerId = new mongoose.Types.ObjectId();

      const openingBalance = Number(data.openingBalance) || 0;
      const openingBalanceType = data.openingBalanceType || ctx.normalBalance;

      const customer = {
        ...data,
        _id: customerId,
        tenantId,
        customerCode: item.code,
        ledgerId,

        // ASSUMPTION: field name. Customers owe us on a DEBIT opening balance.
        receivableBalance: openingBalanceType === "DEBIT" ? openingBalance : 0,
      };

      customers.push(customer);

      ledgers.push({
        _id: ledgerId,
        tenantId,
        ledgerGroupId: ctx.group._id,
        code: `CUST-${item.code}`.toUpperCase(),
        name: data.customerName,
        type: "CUSTOMER",
        nature: ctx.group.nature,
        normalBalance: ctx.normalBalance,
        openingBalance,
        openingBalanceType,
        currentBalance: openingBalance,
        currentBalanceType: openingBalanceType,
        referenceType: "CUSTOMER",
        referenceId: customerId,
        creditLimit: Number(data.creditLimit) || 0,
        creditDays: Number(data.creditDays) || 0,
        isSystem: false,
        isActive: data.status !== "Inactive",
        description: `Customer ledger for ${data.customerName} (${item.code})`,
        createdBy: userId,
        updatedBy: userId,
      });

      audits.push({
        tenantId,
        userId,
        action: "CREATE",
        module: "CUSTOMER",
        documentId: customerId,
        newData: customer,
        ipAddress,
      });
    }

    return [
      { model: models.Customer, docs: customers },
      { model: models.Ledger, docs: ledgers },
      { model: models.AuditLog, docs: audits },
    ];
  },
});

module.exports = { importCustomers };
