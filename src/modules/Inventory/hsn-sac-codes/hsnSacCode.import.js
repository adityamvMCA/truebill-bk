
const mongoose = require("mongoose");

const {
  createBulkImportHandler,
} = require("../../../utils/createBulkImportHandler");

const {
  createHsnSacCodeSchema,
} = require("./hsnSacCode.validation");

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const nullableText = (value) =>
  String(value ?? "").trim() || null;

const importHsnSacCodes = createBulkImportHandler({
  label: "HSN/SAC code",
  modelKey: "HsnSacCode",
  maxRecords: 5000,
  chunkSize: 500,
  schema: createHsnSacCodeSchema,

  uniqueFields: ["code"],

  baseFilter: {},

  // HSN/SAC codes come directly from the CSV.
  // No sequence generation is required.
  reserveCodes: async ({ count }) =>
    Array(count).fill(null),

  transformRow: (row) => ({
    code: normalizeCode(
      row.code ??
        row.hsncode ??
        row.hsn_code ??
        row.hsnsaccode ??
        row.hsn_sac_code
    ),

    description: nullableText(row.description),

    defaultGstRate:
      Number(
        row.defaultgstrate ??
          row.default_gst_rate ??
          row.gstrate ??
          row.gst_rate ??
          0
      ) || 0,

    status: String(row.status || "ACTIVE")
      .trim()
      .toUpperCase(),
  }),

  buildChunk: ({
    items,
    models,
    tenantId,
    userId,
    ipAddress,
  }) => {
    const records = [];
    const audits = [];

    for (const item of items) {
      const data = item.data;

      const recordId = new mongoose.Types.ObjectId();

      const record = {
        _id: recordId,
        tenantId,
        code: data.code,
        description: data.description || null,
        defaultGstRate: data.defaultGstRate,
        status: data.status,
        createdBy: userId,
        updatedBy: userId,
      };

      records.push(record);

      audits.push({
        tenantId,
        userId,
        action: "CREATE",
        module: "HSN_SAC_CODE",
        documentId: recordId,
        newData: record,
        ipAddress,
      });
    }

    return [
      {
        model: models.HsnSacCode,
        docs: records,
      },
      {
        model: models.AuditLog,
        docs: audits,
      },
    ];
  },
});

module.exports = {
  importHsnSacCodes,
};
