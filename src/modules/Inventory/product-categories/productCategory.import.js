const mongoose = require("mongoose");

const {
  createBulkImportHandler,
} = require("../../../utils/createBulkImportHandler");

const {
  createProductCategorySchema,
} = require("./productCategory.validation");

const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const nullableText = (value) =>
  String(value ?? "").trim() || null;

const importProductCategories =
  createBulkImportHandler({
    label: "product category",
    modelKey: "ProductCategory",
    maxRecords: 5000,
    chunkSize: 500,
    schema: createProductCategorySchema,

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
      const categories = [];
      const audits = [];

      for (const item of items) {
        const data = item.data;

        const categoryId =
          new mongoose.Types.ObjectId();

        const category = {
          _id: categoryId,
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

        categories.push(category);

        audits.push({
          tenantId,
          userId,
          action: "CREATE",
          module: "PRODUCT_CATEGORY",
          documentId: categoryId,
          newData: category,
          ipAddress,
        });
      }

      return [
        {
          model: models.ProductCategory,
          docs: categories,
        },

        {
          model: models.AuditLog,
          docs: audits,
        },
      ];
    },
  });

module.exports = {
  importProductCategories,
};