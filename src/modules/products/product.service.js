// const mongoose = require("mongoose");

// const Product = require("./product.model");
// const StockMovement = require("../stock-movements/stockMovement.model");
// const AuditLog = require("../../models/AuditLog");

// const { getNextSequence } = require("../../utils/sequenceGenerator");

// const {
//   normalizeText,
//   parseBoolean,
//   parseNumber,
//   runCsvImport,
// } = require("../../utils/csvImport");

// const normalizeProductCode = (productCode) =>
//   String(productCode || "")
//     .trim()
//     .toUpperCase();

// const cleanNullableText = (value) => {
//   const text = normalizeText(value);

//   return text || null;
// };

// const roundQuantity = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

// const roundAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

// const createProduct = async ({ tenantId, userId, payload, ipAddress }) => {
//   const session = await mongoose.startSession();

//   try {
//     let createdProduct;

//     await session.withTransaction(async () => {
//       const productCode = await getNextSequence("PR", tenantId.toString());

//       const productType = String(payload.type || "GOODS")
//         .trim()
//         .toUpperCase();

//       const trackInventory =
//         productType === "GOODS" ? Boolean(payload.trackInventory) : false;

//       const openingStock = trackInventory
//         ? roundQuantity(payload.openingStock)
//         : 0;

//       const openingStockRate = trackInventory
//         ? roundAmount(payload.openingStockRate)
//         : 0;

//       const productRecords = await Product.create(
//         [
//           {
//             ...payload,

//             productCode,
//             tenantId,

//             name: normalizeText(payload.name),

//             type: productType,

//             unit: String(payload.unit || "NOS")
//               .trim()
//               .toUpperCase(),

//             trackInventory,

//             category: cleanNullableText(payload.category),

//             brand: cleanNullableText(payload.brand),

//             description: cleanNullableText(payload.description),

//             hsnSacCode: cleanNullableText(payload.hsnSacCode),

//             gstRate: Number(payload.gstRate) || 0,

//             salePrice: roundAmount(payload.salePrice),

//             purchasePrice: roundAmount(payload.purchasePrice),

//             openingStock,

//             openingStockRate,

//             reorderLevel: trackInventory
//               ? roundQuantity(payload.reorderLevel)
//               : 0,

//             currentStock: 0,

//             status: String(payload.status || "ACTIVE")
//               .trim()
//               .toUpperCase(),
//           },
//         ],
//         {
//           session,
//         },
//       );

//       const product = productRecords[0];

//       if (trackInventory && openingStock > 0) {
//         const totalValue = roundAmount(openingStock * openingStockRate);

//         await StockMovement.create(
//           [
//             {
//               tenantId,

//               productId: product._id,

//               productCode: product.productCode,

//               movementType: "OPENING",

//               direction: "IN",

//               quantity: openingStock,

//               unitRate: openingStockRate,

//               totalValue,

//               stockBefore: 0,

//               stockAfter: openingStock,

//               referenceType: "OPENING",

//               referenceId: null,

//               referenceNumber: `OPEN-${product.productCode}`,

//               movementDate: new Date(),

//               notes: "Opening stock at product creation",

//               createdBy: userId,
//             },
//           ],
//           {
//             session,
//           },
//         );

//         product.currentStock = openingStock;

//         await product.save({
//           session,
//         });
//       }

//       await AuditLog.create(
//         [
//           {
//             tenantId,

//             userId,

//             action: "CREATE",

//             module: "PRODUCT",

//             documentId: product._id,

//             newData: product.toObject(),

//             ipAddress,
//           },
//         ],
//         {
//           session,
//         },
//       );

//       createdProduct = product;
//     });

//     return createdProduct;
//   } finally {
//     await session.endSession();
//   }
// };

// const importProducts = async ({ tenantId, userId, buffer, ipAddress }) => {
//   return runCsvImport({
//     buffer,

//     requiredHeaders: ["name", "type", "unit"],

//     maxRows: 500,

//     mapRow: (row) => {
//       const type = normalizeText(row.type || "GOODS").toUpperCase();

//       const trackInventory =
//         type === "GOODS"
//           ? parseBoolean(row.trackinventory ?? row.track_inventory, true)
//           : false;

//       return {
//         name: normalizeText(row.name),

//         type,

//         category: normalizeText(row.category),

//         brand: normalizeText(row.brand),

//         description: normalizeText(row.description),

//         unit: normalizeText(row.unit || "NOS").toUpperCase(),

//         hsnSacCode: normalizeText(
//           row.hsnsaccode ?? row.hsn_sac_code ?? row.hsn_sac,
//         ).toUpperCase(),

//         gstRate: parseNumber(row.gstrate ?? row.gst_rate, 18),

//         salePrice: parseNumber(row.saleprice ?? row.sale_price, 0),

//         purchasePrice: parseNumber(row.purchaseprice ?? row.purchase_price, 0),

//         trackInventory,

//         openingStock: trackInventory
//           ? parseNumber(row.openingstock ?? row.opening_stock, 0)
//           : 0,

//         openingStockRate: trackInventory
//           ? parseNumber(row.openingstockrate ?? row.opening_stock_rate, 0)
//           : 0,

//         reorderLevel: trackInventory
//           ? parseNumber(row.reorderlevel ?? row.reorder_level, 0)
//           : 0,

//         status: normalizeText(row.status || "ACTIVE").toUpperCase(),
//       };
//     },

//     processRow: async (payload) => {
//       if (!payload.name) {
//         const error = new Error("Product name is required");

//         error.statusCode = 400;

//         throw error;
//       }

//       if (payload.type === "SERVICE" && payload.trackInventory) {
//         const error = new Error("Services cannot track inventory");

//         error.statusCode = 400;

//         throw error;
//       }

//       return createProduct({
//         tenantId,
//         userId,
//         payload,
//         ipAddress,
//       });
//     },
//   });
// };

// const getProducts = async ({
//   tenantId,
//   search = "",
//   status,
//   type,
//   category,
//   trackInventory,
//   page = 1,
//   limit = 20,
// }) => {
//   const currentPage = Math.max(Number(page) || 1, 1);

//   const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

//   const filter = {
//     tenantId,
//     isDeleted: false,
//   };

//   if (status) {
//     filter.status = String(status).trim().toUpperCase();
//   }

//   if (type) {
//     filter.type = String(type).trim().toUpperCase();
//   }

//   if (category) {
//     filter.category = String(category).trim();
//   }

//   if (trackInventory !== undefined) {
//     filter.trackInventory = String(trackInventory).toLowerCase() === "true";
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     filter.$or = [
//       {
//         name: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },

//       {
//         productCode: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },

//       {
//         hsnSacCode: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },

//       {
//         category: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },

//       {
//         brand: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     Product.find(filter)
//       .sort({
//         createdAt: -1,
//       })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     Product.countDocuments(filter),
//   ]);

//   return {
//     data,

//     pagination: {
//       page: currentPage,

//       limit: pageLimit,

//       total,

//       totalPages: Math.ceil(total / pageLimit),
//     },
//   };
// };

// const getProductByCode = async ({ tenantId, productCode }) => {
//   return Product.findOne({
//     tenantId,

//     productCode: normalizeProductCode(productCode),

//     isDeleted: false,
//   });
// };

// const updateProduct = async ({
//   tenantId,
//   userId,
//   productCode,
//   payload,
//   ipAddress,
// }) => {
//   const product = await Product.findOne({
//     tenantId,

//     productCode: normalizeProductCode(productCode),

//     isDeleted: false,
//   });

//   if (!product) {
//     const error = new Error("Product not found");

//     error.statusCode = 404;

//     throw error;
//   }

//   const oldData = product.toObject();

//   const protectedFields = [
//     "_id",
//     "tenantId",
//     "productCode",
//     "currentStock",
//     "openingStock",
//     "openingStockRate",
//     "salesLedgerId",
//     "purchaseLedgerId",
//     "inventoryLedgerId",
//     "isDeleted",
//     "deletedAt",
//     "deletedBy",
//     "createdAt",
//     "updatedAt",
//     "__v",
//   ];

//   for (const [key, value] of Object.entries(payload || {})) {
//     if (!protectedFields.includes(key)) {
//       product[key] = value;
//     }
//   }

//   if (product.type === "SERVICE") {
//     product.trackInventory = false;

//     product.openingStock = 0;

//     product.openingStockRate = 0;

//     product.reorderLevel = 0;
//   }

//   await product.save();

//   await AuditLog.create({
//     tenantId,

//     userId,

//     action: "UPDATE",

//     module: "PRODUCT",

//     documentId: product._id,

//     oldData,

//     newData: product.toObject(),

//     ipAddress,
//   });

//   return product;
// };

// const deleteProduct = async ({ tenantId, userId, productCode, ipAddress }) => {
//   const product = await Product.findOne({
//     tenantId,

//     productCode: normalizeProductCode(productCode),

//     isDeleted: false,
//   });

//   if (!product) {
//     const error = new Error("Product not found");

//     error.statusCode = 404;

//     throw error;
//   }

//   const oldData = product.toObject();

//   product.isDeleted = true;

//   product.deletedAt = new Date();

//   product.deletedBy = userId;

//   product.status = "INACTIVE";

//   await product.save();

//   await AuditLog.create({
//     tenantId,

//     userId,

//     action: "DELETE",

//     module: "PRODUCT",

//     documentId: product._id,

//     oldData,

//     newData: product.toObject(),

//     ipAddress,
//   });

//   return product;
// };

// module.exports = {
//   createProduct,
//   importProducts,
//   getProducts,
//   getProductByCode,
//   updateProduct,
//   deleteProduct,
// };

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const {
  normalizeText,
  parseBoolean,
  parseNumber,
  runCsvImport,
} = require("../../utils/csvImport");

const normalizeProductCode = (productCode) =>
  String(productCode || "")
    .trim()
    .toUpperCase();

const cleanNullableText = (value) => {
  const text = normalizeText(value);

  return text || null;
};

const roundQuantity = (value) =>
  Math.round((Number(value) || 0) * 1000) / 1000;

const roundAmount = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

const createProduct = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Product,
    StockMovement,
    AuditLog,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let createdProduct;

    await session.withTransaction(async () => {
      const productCode = await getNextSequence(
        "PR",
        tenantId.toString(),
        3,
        {
          connection,
          session,
        },
      );

      const productType = String(payload.type || "GOODS")
        .trim()
        .toUpperCase();

      const trackInventory =
        productType === "GOODS" ? Boolean(payload.trackInventory) : false;

      const openingStock = trackInventory
        ? roundQuantity(payload.openingStock)
        : 0;

      const openingStockRate = trackInventory
        ? roundAmount(payload.openingStockRate)
        : 0;

      const productRecords = await Product.create(
        [
          {
            ...payload,

            productCode,
            tenantId,

            name: normalizeText(payload.name),

            type: productType,

            unit: String(payload.unit || "NOS")
              .trim()
              .toUpperCase(),

            trackInventory,

            category: cleanNullableText(payload.category),

            brand: cleanNullableText(payload.brand),

            description: cleanNullableText(payload.description),

            hsnSacCode: cleanNullableText(payload.hsnSacCode),

            gstRate: Number(payload.gstRate) || 0,

            salePrice: roundAmount(payload.salePrice),

            purchasePrice: roundAmount(payload.purchasePrice),

            openingStock,

            openingStockRate,

            reorderLevel: trackInventory
              ? roundQuantity(payload.reorderLevel)
              : 0,

            currentStock: 0,

            status: String(payload.status || "ACTIVE")
              .trim()
              .toUpperCase(),
          },
        ],
        {
          session,
        },
      );

      const product = productRecords[0];

      if (trackInventory && openingStock > 0) {
        const totalValue = roundAmount(openingStock * openingStockRate);

        await StockMovement.create(
          [
            {
              tenantId,

              productId: product._id,

              productCode: product.productCode,

              movementType: "OPENING",

              direction: "IN",

              quantity: openingStock,

              unitRate: openingStockRate,

              totalValue,

              stockBefore: 0,

              stockAfter: openingStock,

              referenceType: "OPENING",

              referenceId: null,

              referenceNumber: `OPEN-${product.productCode}`,

              movementDate: new Date(),

              notes: "Opening stock at product creation",

              createdBy: userId,
            },
          ],
          {
            session,
          },
        );

        product.currentStock = openingStock;

        await product.save({
          session,
        });
      }

      await AuditLog.create(
        [
          {
            tenantId,

            userId,

            action: "CREATE",

            module: "PRODUCT",

            documentId: product._id,

            newData: product.toObject(),

            ipAddress,
          },
        ],
        {
          session,
        },
      );

      createdProduct = product;
    });

    return createdProduct;
  } finally {
    await session.endSession();
  }
};

const importProducts = async ({
  tenant,
  userId,
  buffer,
  ipAddress,
}) => {
  getReadyTenantConnection(tenant);

  return runCsvImport({
    buffer,

    requiredHeaders: ["name", "type", "unit"],

    maxRows: 500,

    mapRow: (row) => {
      const type = normalizeText(row.type || "GOODS").toUpperCase();

      const trackInventory =
        type === "GOODS"
          ? parseBoolean(row.trackinventory ?? row.track_inventory, true)
          : false;

      return {
        name: normalizeText(row.name),

        type,

        category: normalizeText(row.category),

        brand: normalizeText(row.brand),

        description: normalizeText(row.description),

        unit: normalizeText(row.unit || "NOS").toUpperCase(),

        hsnSacCode: normalizeText(
          row.hsnsaccode ?? row.hsn_sac_code ?? row.hsn_sac,
        ).toUpperCase(),

        gstRate: parseNumber(row.gstrate ?? row.gst_rate, 18),

        salePrice: parseNumber(row.saleprice ?? row.sale_price, 0),

        purchasePrice: parseNumber(row.purchaseprice ?? row.purchase_price, 0),

        trackInventory,

        openingStock: trackInventory
          ? parseNumber(row.openingstock ?? row.opening_stock, 0)
          : 0,

        openingStockRate: trackInventory
          ? parseNumber(row.openingstockrate ?? row.opening_stock_rate, 0)
          : 0,

        reorderLevel: trackInventory
          ? parseNumber(row.reorderlevel ?? row.reorder_level, 0)
          : 0,

        status: normalizeText(row.status || "ACTIVE").toUpperCase(),
      };
    },

    processRow: async (payload) => {
      if (!payload.name) {
        const error = new Error("Product name is required");

        error.statusCode = 400;

        throw error;
      }

      if (payload.type === "SERVICE" && payload.trackInventory) {
        const error = new Error("Services cannot track inventory");

        error.statusCode = 400;

        throw error;
      }

      return createProduct({
        tenant,
        userId,
        payload,
        ipAddress,
      });
    },
  });
};

const getProducts = async ({
  tenant,
  search = "",
  status,
  type,
  category,
  trackInventory,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { Product } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Number(page) || 1, 1);

  const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = String(status).trim().toUpperCase();
  }

  if (type) {
    filter.type = String(type).trim().toUpperCase();
  }

  if (category) {
    filter.category = String(category).trim();
  }

  if (trackInventory !== undefined) {
    filter.trackInventory = String(trackInventory).toLowerCase() === "true";
  }

  const searchText = normalizeText(search);

  if (searchText) {
    filter.$or = [
      {
        name: {
          $regex: searchText,
          $options: "i",
        },
      },

      {
        productCode: {
          $regex: searchText,
          $options: "i",
        },
      },

      {
        hsnSacCode: {
          $regex: searchText,
          $options: "i",
        },
      },

      {
        category: {
          $regex: searchText,
          $options: "i",
        },
      },

      {
        brand: {
          $regex: searchText,
          $options: "i",
        },
      },
    ];
  }

  const [data, total] = await Promise.all([
    Product.find(filter)
      .sort({
        createdAt: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    Product.countDocuments(filter),
  ]);

  return {
    data,

    pagination: {
      page: currentPage,

      limit: pageLimit,

      total,

      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getProductByCode = async ({
  tenant,
  productCode,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { Product } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  return Product.findOne({
    tenantId,

    productCode: normalizeProductCode(productCode),

    isDeleted: false,
  });
};

const updateProduct = async ({
  tenant,
  userId,
  productCode,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Product,
    AuditLog,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const product = await Product.findOne({
    tenantId,

    productCode: normalizeProductCode(productCode),

    isDeleted: false,
  });

  if (!product) {
    const error = new Error("Product not found");

    error.statusCode = 404;

    throw error;
  }

  const oldData = product.toObject();

  const protectedFields = [
    "_id",
    "tenantId",
    "productCode",
    "currentStock",
    "openingStock",
    "openingStockRate",
    "salesLedgerId",
    "purchaseLedgerId",
    "inventoryLedgerId",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdAt",
    "updatedAt",
    "__v",
  ];

  for (const [key, value] of Object.entries(payload || {})) {
    if (!protectedFields.includes(key)) {
      product[key] = value;
    }
  }

  if (product.type === "SERVICE") {
    product.trackInventory = false;

    product.openingStock = 0;

    product.openingStockRate = 0;

    product.reorderLevel = 0;
  }

  await product.save();

  await AuditLog.create({
    tenantId,

    userId,

    action: "UPDATE",

    module: "PRODUCT",

    documentId: product._id,

    oldData,

    newData: product.toObject(),

    ipAddress,
  });

  return product;
};

const deleteProduct = async ({
  tenant,
  userId,
  productCode,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Product,
    AuditLog,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const product = await Product.findOne({
    tenantId,

    productCode: normalizeProductCode(productCode),

    isDeleted: false,
  });

  if (!product) {
    const error = new Error("Product not found");

    error.statusCode = 404;

    throw error;
  }

  const oldData = product.toObject();

  product.isDeleted = true;

  product.deletedAt = new Date();

  product.deletedBy = userId;

  product.status = "INACTIVE";

  await product.save();

  await AuditLog.create({
    tenantId,

    userId,

    action: "DELETE",

    module: "PRODUCT",

    documentId: product._id,

    oldData,

    newData: product.toObject(),

    ipAddress,
  });

  return product;
};

module.exports = {
  createProduct,
  importProducts,
  getProducts,
  getProductByCode,
  updateProduct,
  deleteProduct,
};