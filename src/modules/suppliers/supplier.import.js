const mongoose = require("mongoose");

const { getNextSequence } = require("../../utils/sequenceGenerator");
const {
  createBulkImportHandler,
} = require("../../utils/createBulkImportHandler");
const { createSupplierSchema } = require("./supplier.validation");

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
const reserveSupplierCodes = async ({ count, tenant, connection }) => {
  const codes = [];
  const PARALLEL = 50;

  for (let i = 0; i < count; i += PARALLEL) {
    const size = Math.min(PARALLEL, count - i);

    const part = await Promise.all(
      Array.from({ length: size }, () =>
        getNextSequence("SU", tenant._id.toString(), 3, { connection }),
      ),
    );

    codes.push(...part);
  }

  return codes.sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true }),
  );
};

const importSuppliers = createBulkImportHandler({
  label: "supplier",
  modelKey: "Supplier",
  maxRecords: 5000,
  chunkSize: 500,
  schema: createSupplierSchema,
  uniqueFields: ["gstNo"],
  baseFilter: { isDeleted: false },

  // CSV users type ACTIVE / business / credit: normalise to your enums
  transformRow: (row) => ({
    ...row,
    supplierType: titleCase(row.supplierType),
    status: titleCase(row.status),
    openingBalanceType:
      typeof row.openingBalanceType === "string"
        ? row.openingBalanceType.toUpperCase()
        : row.openingBalanceType,
  }),

  // Runs once per request instead of once per supplier
  prepare: async ({ models, tenantId }) => {
    const group = await models.LedgerGroup.findOne({
      tenantId,
      code: "SUNDRY_CREDITORS",
      isActive: true,
    }).lean();

    if (!group) {
      const error = new Error(
        "Sundry Creditors ledger group is missing. Seed accounting groups before importing suppliers.",
      );
      error.statusCode = 400;
      throw error;
    }

    const normalBalance = NORMAL_BALANCE_BY_NATURE[group.nature];

    if (!normalBalance) {
      const error = new Error(
        "Sundry Creditors ledger group has an invalid account nature.",
      );
      error.statusCode = 400;
      throw error;
    }

    return { group, normalBalance };
  },

  reserveCodes: reserveSupplierCodes,

  buildChunk: ({ items, ctx, models, tenantId, userId, ipAddress }) => {
    const suppliers = [];
    const ledgers = [];
    const audits = [];

    for (const item of items) {
      const data = item.data;

      // Pre-generate ids so supplier <-> ledger link needs no second write
      const supplierId = new mongoose.Types.ObjectId();
      const ledgerId = new mongoose.Types.ObjectId();

      const openingBalance = Number(data.openingBalance) || 0;
      const openingBalanceType = data.openingBalanceType || ctx.normalBalance;

      const supplier = {
        ...data,
        _id: supplierId,
        tenantId,
        supplierCode: item.code,
        ledgerId,
        payableBalance: openingBalanceType === "CREDIT" ? openingBalance : 0,
      };

      suppliers.push(supplier);

      ledgers.push({
        _id: ledgerId,
        tenantId,
        ledgerGroupId: ctx.group._id,
        code: `SUPP-${item.code}`.toUpperCase(),
        name: data.supplierName,
        type: "SUPPLIER",
        nature: ctx.group.nature,
        normalBalance: ctx.normalBalance,
        openingBalance,
        openingBalanceType,
        currentBalance: openingBalance,
        currentBalanceType: openingBalanceType,
        referenceType: "SUPPLIER",
        referenceId: supplierId,
        creditLimit: Number(data.creditLimit) || 0,
        creditDays: Number(data.creditDays) || 0,
        isSystem: false,
        isActive: data.status !== "Inactive",
        description: `Supplier ledger for ${data.supplierName} (${item.code})`,
        createdBy: userId,
        updatedBy: userId,
      });

      audits.push({
        tenantId,
        userId,
        action: "CREATE",
        module: "SUPPLIER",
        documentId: supplierId,
        newData: supplier,
        ipAddress,
      });
    }

    return [
      { model: models.Supplier, docs: suppliers },
      { model: models.Ledger, docs: ledgers },
      { model: models.AuditLog, docs: audits },
    ];
  },
});

module.exports = { importSuppliers };
