// const {
//   createBulkImportHandler,
// } = require("../../utils/createBulkImportHandler");

// const { createProductSchema } = require("./product.validation");

// const { createProduct } = require("./product.service");

// const normalizeText = (value) =>
//   String(value ?? "")
//     .trim()
//     .replace(/\s+/g, " ");

// const normalizeCode = (value) =>
//   String(value ?? "")
//     .trim()
//     .toUpperCase();

// const parseBoolean = (value, fallback = false) => {
//   if (value === undefined || value === null || value === "") {
//     return fallback;
//   }

//   const text = String(value).trim().toLowerCase();

//   if (["true", "yes", "1", "y"].includes(text)) {
//     return true;
//   }

//   if (["false", "no", "0", "n"].includes(text)) {
//     return false;
//   }

//   return fallback;
// };

// const parseNumber = (value, fallback = 0) => {
//   if (value === undefined || value === null || value === "") {
//     return fallback;
//   }

//   const number = Number(value);

//   return Number.isFinite(number) ? number : fallback;
// };

// const importProducts = createBulkImportHandler({
//   label: "product",
//   modelKey: "Product",
//   maxRecords: 5000,
//   chunkSize: 100,
//   schema: createProductSchema,

//   uniqueFields: ["name"],

//   baseFilter: {
//     isDeleted: false,
//   },

//   transformRow: (row) => {
//     const type = normalizeText(row.type || "GOODS").toUpperCase();

//     const trackInventory =
//       type === "GOODS"
//         ? parseBoolean(row.trackinventory ?? row.track_inventory, true)
//         : false;

//     return {
//       name: normalizeText(row.name),

//       type,

//       category: normalizeText(row.category),

//       brand: normalizeText(row.brand),

//       description: normalizeText(row.description),

//       unit: normalizeCode(row.unit || "NOS"),

//       hsnSacCode: normalizeCode(
//         row.hsnsaccode ?? row.hsn_sac_code ?? row.hsn_sac,
//       ),

//       gstRate: parseNumber(row.gstrate ?? row.gst_rate, 18),

//       salePrice: parseNumber(row.saleprice ?? row.sale_price, 0),

//       purchasePrice: parseNumber(row.purchaseprice ?? row.purchase_price, 0),

//       trackInventory,

//       openingStock: trackInventory
//         ? parseNumber(row.openingstock ?? row.opening_stock, 0)
//         : 0,

//       openingStockRate: trackInventory
//         ? parseNumber(row.openingstockrate ?? row.opening_stock_rate, 0)
//         : 0,

//       reorderLevel: trackInventory
//         ? parseNumber(row.reorderlevel ?? row.reorder_level, 0)
//         : 0,

//       status: normalizeText(row.status || "ACTIVE").toUpperCase(),
//     };
//   },

//   processRow: async ({ data, tenant, userId, ipAddress }) =>
//     createProduct({
//       tenant,
//       userId,
//       payload: data,
//       ipAddress,
//     }),
// });

// module.exports = {
//   importProducts,
// };

const mongoose = require("mongoose");

const { getNextSequence } = require("../../utils/sequenceGenerator");
const {
  createBulkImportHandler,
} = require("../../utils/createBulkImportHandler");
const { createProductSchema } = require("./product.validation");

const normalizeText = (value) =>
  String(value ?? "").trim().replace(/\s+/g, " ");

const normalizeCode = (value) =>
  String(value ?? "").trim().toUpperCase();

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const text = String(value).trim().toLowerCase();

  if (["true", "yes", "1", "y"].includes(text)) {
    return true;
  }

  if (["false", "no", "0", "n"].includes(text)) {
    return false;
  }

  return fallback;
};

const parseNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};

const reserveProductCodes = async ({ count, tenant, connection }) => {
  const codes = [];
  const PARALLEL = 50;

  for (let i = 0; i < count; i += PARALLEL) {
    const size = Math.min(PARALLEL, count - i);

    const part = await Promise.all(
      Array.from({ length: size }, () =>
        getNextSequence("PR", tenant._id.toString(), 3, {
          connection,
        })
      )
    );

    codes.push(...part);
  }

  return codes.sort((a, b) =>
    String(a).localeCompare(String(b), undefined, {
      numeric: true,
    })
  );
};

const importProducts = createBulkImportHandler({
  label: "product",
  modelKey: "Product",
  maxRecords: 5000,
  chunkSize: 100,
  schema: createProductSchema,

  uniqueFields: ["name"],
  baseFilter: {
    isDeleted: false,
  },

  transformRow: (row) => {
    const type = normalizeText(row.type || "GOODS").toUpperCase();

    const trackInventory =
      type === "GOODS"
        ? parseBoolean(row.trackInventory, true)
        : false;

    return {
      name: normalizeText(row.name),
      type,
      category: normalizeText(row.category),
      brand: normalizeText(row.brand),
      description: normalizeText(row.description),
      unit: normalizeCode(row.unit || "NOS"),
      hsnSacCode: normalizeCode(row.hsnSacCode),
      gstRate: parseNumber(row.gstRate, 18),
      salePrice: parseNumber(row.salePrice, 0),
      purchasePrice: parseNumber(row.purchasePrice, 0),
      trackInventory,
      openingStock: trackInventory
        ? parseNumber(row.openingStock, 0)
        : 0,
      openingStockRate: trackInventory
        ? parseNumber(row.openingStockRate, 0)
        : 0,
      reorderLevel: trackInventory
        ? parseNumber(row.reorderLevel, 0)
        : 0,
      status: normalizeText(row.status || "ACTIVE").toUpperCase(),
    };
  },

  reserveCodes: reserveProductCodes,

  buildChunk: ({
    items,
    models,
    tenantId,
    userId,
    ipAddress,
  }) => {
    const products = [];
    const audits = [];

    for (const item of items) {
      const data = item.data;

      const productId = new mongoose.Types.ObjectId();

      const product = {
        ...data,
        _id: productId,
        tenantId,
        productCode: item.code,
        createdBy: userId,
        updatedBy: userId,
        isDeleted: false,
      };

      products.push(product);

      audits.push({
        tenantId,
        userId,
        action: "CREATE",
        module: "PRODUCT",
        documentId: productId,
        newData: product,
        ipAddress,
      });
    }

    return [
      {
        model: models.Product,
        docs: products,
      },
      {
        model: models.AuditLog,
        docs: audits,
      },
    ];
  },
});

module.exports = { importProducts };