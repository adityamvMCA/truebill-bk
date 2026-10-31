const mongoose = require("mongoose");

const {
  createBulkImportHandler,
} = require("../../utils/createBulkImportHandler");

const { createTaxRateSchema } = require("./taxRate.validation");

const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const nullableText = (value) => String(value ?? "").trim() || null;

const importTaxRates = createBulkImportHandler({
  label: "tax rate",
  modelKey: "TaxRate",
  maxRecords: 5000,
  chunkSize: 500,
  schema: createTaxRateSchema,

  uniqueFields: ["name",],

  baseFilter: {},

  transformRow: (row) => ({
    name: normalizeName(row.name),

    rate: Number(row.rate ?? row.gstrate ?? row.gst_rate ?? 0) || 0,

    taxType: String(row.taxtype ?? row.tax_type ?? "GST")
      .trim()
      .toUpperCase(),

    description: nullableText(row.description),

    status: String(row.status || "ACTIVE")
      .trim()
      .toUpperCase(),
  }),

  buildChunk: ({ items, models, tenantId, userId, ipAddress }) => {
    const taxRates = [];
    const audits = [];

    for (const item of items) {
      const data = item.data;

      const taxRateId = new mongoose.Types.ObjectId();

      const taxRate = {
        _id: taxRateId,
        tenantId,
        name: data.name,
        normalizedName: data.name.toLowerCase(),
        rate: data.rate,
        taxType: data.taxType,
        description: data.description || null,
        status: data.status,
        isSystem: false,
        createdBy: userId,
        updatedBy: userId,
      };

      taxRates.push(taxRate);

      audits.push({
        tenantId,
        userId,
        action: "CREATE",
        module: "TAX_RATE",
        documentId: taxRateId,
        newData: taxRate,
        ipAddress,
      });
    }

    return [
      {
        model: models.TaxRate,
        docs: taxRates,
      },

      {
        model: models.AuditLog,
        docs: audits,
      },
    ];
  },
});

module.exports = {
  importTaxRates,
};
