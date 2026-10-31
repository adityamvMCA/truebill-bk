const mongoose = require("mongoose");

const {
  createBulkImportHandler,
} = require("../../../utils/createBulkImportHandler");

const { createProductUnitSchema } = require("./productUnit.validation");

const normalizeCode = (value) =>
  String(value ?? "").trim().toUpperCase();

const normalizeName = (value) =>
  String(value ?? "").trim().replace(/\s+/g, " ");

const nullableText = (value) =>
  String(value ?? "").trim() || null;

const importProductUnits = createBulkImportHandler({
  label: "product unit",
  modelKey: "ProductUnit",
  maxRecords: 5000,
  chunkSize: 500,
  schema: createProductUnitSchema,
  uniqueFields: ["unitCode", "normalizedName"],
  baseFilter: {},
  externalUniques: [],

  prepare: async () => ({}),

  transformRow: (row) => {
    const name = normalizeName(row.name);

    return {
      unitCode: normalizeCode(
        row.unitcode ?? row.unit_code ?? row.unitCode
      ),
      name,
      normalizedName: name.toLowerCase(),
      symbol: nullableText(row.symbol),
      description: nullableText(row.description),
      status: String(row.status || "ACTIVE").trim().toUpperCase(),
    };
  },

  buildChunk: ({ items, models, tenantId, userId, ipAddress }) => {
    const units = [];
    const audits = [];

    for (const item of items) {
      const data = item.data;
      const unitId = new mongoose.Types.ObjectId();

      const unit = {
        _id: unitId,
        tenantId,
        unitCode: data.unitCode,
        name: data.name,
        normalizedName: data.normalizedName,
        symbol: data.symbol || null,
        description: data.description || null,
        status: data.status,
        isSystem: false,
        createdBy: userId,
        updatedBy: userId,
      };

      units.push(unit);

      audits.push({
        tenantId,
        userId,
        action: "CREATE",
        module: "PRODUCT_UNIT",
        documentId: unitId,
        newData: unit,
        ipAddress,
      });
    }

    return [
      {
        model: models.ProductUnit,
        docs: units,
      },
      {
        model: models.AuditLog,
        docs: audits,
      },
    ];
  },
});

module.exports = {
  importProductUnits,
};