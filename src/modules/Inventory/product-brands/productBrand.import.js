const mongoose = require("mongoose");

const {
  createBulkImportHandler,
} = require("../../../utils/createBulkImportHandler");

const {
  createProductBrandSchema,
} = require("./productBrand.validation");

const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const nullableText = (value) =>
  String(value ?? "").trim() || null;

const importProductBrands =
  createBulkImportHandler({
    label: "product brand",
    modelKey: "ProductBrand",
    maxRecords: 5000,
    chunkSize: 500,
    schema: createProductBrandSchema,

    uniqueFields: [
      "name",
    ],

    baseFilter: {},

    transformRow: (row) => ({
      name: normalizeName(row.name),

      description: nullableText(
        row.description,
      ),

      status:
        String(
          row.status || "ACTIVE",
        )
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
      const brands = [];
      const audits = [];

      for (const item of items) {
        const data = item.data;

        const brandId =
          new mongoose.Types.ObjectId();

        const brand = {
          _id: brandId,
          tenantId,
          name: data.name,
          normalizedName: data.name
            .toLowerCase(),

          description:
            data.description || null,

          status: data.status,

          createdBy: userId,
          updatedBy: userId,
        };

        brands.push(brand);

        audits.push({
          tenantId,
          userId,
          action: "CREATE",
          module: "PRODUCT_BRAND",
          documentId: brandId,
          newData: brand,
          ipAddress,
        });
      }

      return [
        {
          model: models.ProductBrand,
          docs: brands,
        },

        {
          model: models.AuditLog,
          docs: audits,
        },
      ];
    },
  });

module.exports = {
  importProductBrands,
};