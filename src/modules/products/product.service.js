const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { resolveProductBrand } = require("../../utils/resolveProductBrand");

const { resolveProductUnit } = require("../../utils/resolveProductUnit");

const { resolveHsnSacCode } = require("../../utils/resolveHsnSacCode");

const { resolveTaxRate } = require("../../utils/resolveTaxRate");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const {
  normalizeText,
  parseBoolean,
  parseNumber,
  runCsvImport,
} = require("../../utils/csvImport");

const PRODUCT_TYPES = ["GOODS", "SERVICE"];

const PRODUCT_STATUS = ["ACTIVE", "INACTIVE"];

const EDITABLE_FIELDS = [
  "name",
  "type",
  "category",
  "brand",
  "description",
  "unit",
  "hsnSacCode",
  "gstRate",
  "salePrice",
  "purchasePrice",
  "trackInventory",
  "reorderLevel",
  "status",
];

const hasOwn = (object, field) =>
  Object.prototype.hasOwnProperty.call(object, field);

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeProductCode = (productCode) =>
  String(productCode ?? "")
    .trim()
    .toUpperCase();

const cleanNullableText = (value) => {
  const text = normalizeText(value);
  return text || null;
};

const normalizeCategoryName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const roundQuantity = (value) => Math.round(Number(value) * 1000) / 1000;

const roundAmount = (value) => Math.round(Number(value) * 100) / 100;

const validateObjectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }
};

const validateScaledNumber = ({ value, label, scale, maximum }) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw createError(`${label} must be between 0 and ${maximum}`);
  }

  const scaled = value * scale;
  const rounded = Math.round(scaled);

  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw createError(`${label} has too many decimal places`);
  }

  return rounded / scale;
};

const resolveContext = (tenant) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of ["Product", "StockMovement", "AuditLog"]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  validateObjectId(tenant._id, "tenantId");

  return {
    connection,
    models,
    tenantId: tenant._id,
  };
};

const runTransaction = async ({ tenant, userId }, operation) => {
  const context = resolveContext(tenant);

  validateObjectId(userId, "userId");

  const session = await context.connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({
        ...context,
        userId,
        session,
      });
    });

    return result;
  } catch (error) {
    if (error.code === 11000) {
      throw createError("Product name or product code already exists", 409);
    }

    if (error.name === "VersionError") {
      throw createError("Product changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const createAudit = async ({
  context,
  product,
  action,
  oldData = null,
  ipAddress,
}) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "PRODUCT",
        documentId: product._id,
        oldData,
        newData: product.toObject(),
        ipAddress,
      },
    ],
    {
      session: context.session,
    },
  );
};

const resolveProductCategory = async ({
  models,
  tenantId,
  value,
  session,
  existingCategory = null,
  preserveExisting = false,
}) => {
  const name = normalizeCategoryName(value);

  if (!name) {
    return null;
  }

  if (name.length > 100) {
    throw createError("Category cannot exceed 100 characters");
  }

  const existingName = normalizeCategoryName(existingCategory);

  if (
    preserveExisting &&
    existingName &&
    name.toLowerCase() === existingName.toLowerCase()
  ) {
    return existingCategory;
  }

  const { ProductCategory, Product } = models;

  if (!ProductCategory || ProductCategory.db !== Product.db) {
    throw createError(
      "ProductCategory is not registered on the product tenant connection",
      500,
    );
  }

  const category = await ProductCategory.findOne({
    tenantId,
    normalizedName: name.toLowerCase(),
  })
    .session(session)
    .lean();

  if (!category) {
    throw createError(
      `Category "${name}" does not exist. Create it in Inventory Categories first.`,
      409,
    );
  }

  if (category.status !== "ACTIVE") {
    throw createError(`Category "${category.name}" is inactive`, 409);
  }

  const locked = await ProductCategory.updateOne(
    {
      _id: category._id,
      tenantId,
      status: "ACTIVE",
      __v: category.__v,
    },
    {
      $inc: {
        __v: 1,
      },
    },
    {
      session,
      timestamps: false,
    },
  );

  if (locked.modifiedCount !== 1) {
    throw createError(
      "Category changed. Reload the categories and try again.",
      409,
    );
  }

  return category.name;
};

const buildProductFields = (payload, creating = false) => {
  const fields = {};

  if (creating || hasOwn(payload, "name")) {
    const name = normalizeText(payload.name);

    if (!name || name.length < 2 || name.length > 200) {
      throw createError("Product name must contain 2–200 characters");
    }

    fields.name = name;
  }

  if (creating || hasOwn(payload, "type")) {
    const type = String(payload.type ?? "GOODS")
      .trim()
      .toUpperCase();

    if (!PRODUCT_TYPES.includes(type)) {
      throw createError("Product type must be GOODS or SERVICE");
    }

    fields.type = type;
  }

  if (creating || hasOwn(payload, "unit")) {
    fields.unit = String(payload.unit ?? "NOS")
      .trim()
      .toUpperCase();
  }

  if (creating || hasOwn(payload, "status")) {
    const status = String(payload.status ?? "ACTIVE")
      .trim()
      .toUpperCase();

    if (!PRODUCT_STATUS.includes(status)) {
      throw createError("Status must be ACTIVE or INACTIVE");
    }

    fields.status = status;
  }

  for (const [field, maximum] of [
    ["brand", 100],
    ["description", 1000],
  ]) {
    if (creating || hasOwn(payload, field)) {
      const value = cleanNullableText(payload[field]);

      if (value && value.length > maximum) {
        throw createError(`${field} cannot exceed ${maximum} characters`);
      }

      fields[field] = value;
    }
  }

  if (creating || hasOwn(payload, "hsnSacCode")) {
    const value = cleanNullableText(
      String(payload.hsnSacCode ?? "").toUpperCase(),
    );

    if (value && value.length > 20) {
      throw createError("HSN/SAC code cannot exceed 20 characters");
    }

    fields.hsnSacCode = value;
  }

  if (creating || hasOwn(payload, "gstRate")) {
    const gstRate = payload.gstRate ?? 18;

    if (
      typeof gstRate !== "number" ||
      !Number.isFinite(gstRate) ||
      gstRate < 0 ||
      gstRate > 100
    ) {
      throw createError("GST rate must be between 0 and 100");
    }

    fields.gstRate = gstRate;
  }

  for (const field of ["salePrice", "purchasePrice"]) {
    if (creating || hasOwn(payload, field)) {
      fields[field] = validateScaledNumber({
        value: payload[field] ?? 0,

        label: field,
        scale: 100,
        maximum: 1000000000,
      });
    }
  }

  if (creating || hasOwn(payload, "trackInventory")) {
    const trackInventory =
      payload.trackInventory ?? (fields.type === "SERVICE" ? false : true);

    if (typeof trackInventory !== "boolean") {
      throw createError("trackInventory must be a boolean");
    }

    fields.trackInventory = trackInventory;
  }

  if (creating || hasOwn(payload, "reorderLevel")) {
    fields.reorderLevel = validateScaledNumber({
      value: payload.reorderLevel ?? 0,

      label: "Reorder level",
      scale: 1000,
      maximum: 1000000,
    });
  }

  if (creating) {
    fields.openingStock = validateScaledNumber({
      value: payload.openingStock ?? 0,

      label: "Opening stock",
      scale: 1000,
      maximum: 1000000,
    });

    fields.openingStockRate = validateScaledNumber({
      value: payload.openingStockRate ?? 0,

      label: "Opening stock rate",
      scale: 100,
      maximum: 1000000000,
    });
  }

  return fields;
};

const createProduct = async ({ tenant, userId, payload, ipAddress }) =>
  runTransaction(
    {
      tenant,
      userId,
    },
    async (context) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw createError("Product payload is required");
      }

      const { Product, StockMovement } = context.models;

      const fields = buildProductFields(payload, true);

      const category = await resolveProductCategory({
        models: context.models,
        tenantId: context.tenantId,
        value: payload.category,
        session: context.session,
      });

      fields.brand = await resolveProductBrand({
        models: context.models,
        tenantId: context.tenantId,
        value: fields.brand,
        session: context.session,
      });

      fields.unit = await resolveProductUnit({
        models: context.models,
        tenantId: context.tenantId,
        value: fields.unit,
        session: context.session,
      });

      fields.hsnSacCode = await resolveHsnSacCode({
        models: context.models,
        tenantId: context.tenantId,
        value: fields.hsnSacCode,
        session: context.session,
      });

      fields.gstRate = await resolveTaxRate({
        models: context.models,
        tenantId: context.tenantId,
        value: fields.gstRate,
        session: context.session,
      });

      const productType = fields.type;

      const trackInventory =
        productType === "GOODS" ? fields.trackInventory : false;

      const openingStock = trackInventory ? fields.openingStock : 0;

      const openingStockRate = trackInventory ? fields.openingStockRate : 0;

      const reorderLevel = trackInventory ? fields.reorderLevel : 0;

      const productCode = await getNextSequence(
        "PR",
        String(context.tenantId),
        3,
        {
          connection: context.connection,

          session: context.session,
        },
      );

      const [product] = await Product.create(
        [
          {
            ...fields,
            tenantId: context.tenantId,

            productCode,
            category,
            trackInventory,
            openingStock,
            openingStockRate,
            reorderLevel,
            currentStock: 0,
          },
        ],
        {
          session: context.session,
        },
      );

      if (trackInventory && openingStock > 0) {
        const totalValue = roundAmount(openingStock * openingStockRate);

        if (
          !Number.isFinite(totalValue) ||
          !Number.isSafeInteger(Math.round(totalValue * 100))
        ) {
          throw createError("Opening stock value exceeds the supported range");
        }

        await StockMovement.create(
          [
            {
              tenantId: context.tenantId,

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

              createdBy: context.userId,
            },
          ],
          {
            session: context.session,
          },
        );

        product.currentStock = openingStock;

        await product.save({
          session: context.session,
        });
      }

      await createAudit({
        context,
        product,
        action: "CREATE",
        ipAddress,
      });

      return product;
    },
  );

const importProducts = async ({ tenant, userId, buffer, ipAddress }) => {
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
        throw createError("Product name is required");
      }

      if (payload.type === "SERVICE" && payload.trackInventory) {
        throw createError("Services cannot track inventory");
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
  const { models, tenantId } = resolveContext(tenant);

  const { Product } = models;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const skip = (currentPage - 1) * pageLimit;

  if (!Number.isSafeInteger(skip)) {
    throw createError("Pagination offset exceeds the supported range");
  }

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    const normalizedStatus = String(status).trim().toUpperCase();

    if (!PRODUCT_STATUS.includes(normalizedStatus)) {
      throw createError("Invalid product status");
    }

    filter.status = normalizedStatus;
  }

  if (type) {
    const normalizedType = String(type).trim().toUpperCase();

    if (!PRODUCT_TYPES.includes(normalizedType)) {
      throw createError("Invalid product type");
    }

    filter.type = normalizedType;
  }

  if (category) {
    filter.category = normalizeCategoryName(category);
  }

  if (
    trackInventory !== undefined &&
    trackInventory !== null &&
    trackInventory !== ""
  ) {
    const value = String(trackInventory).trim().toLowerCase();

    if (!["true", "false"].includes(value)) {
      throw createError("trackInventory must be true or false");
    }

    filter.trackInventory = value === "true";
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { name: regex },
      { productCode: regex },
      { hsnSacCode: regex },
      { category: regex },
      { brand: regex },
    ];
  }

  const [data, total] = await Promise.all([
    Product.find(filter)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .skip(skip)
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

const getProductByCode = async ({ tenant, productCode }) => {
  const { models, tenantId } = resolveContext(tenant);

  const normalizedCode = normalizeProductCode(productCode);

  if (!normalizedCode || ["UNDEFINED", "NULL"].includes(normalizedCode)) {
    throw createError("A valid product code is required");
  }

  return models.Product.findOne({
    tenantId,
    productCode: normalizedCode,
    isDeleted: false,
  });
};

const updateProduct = async ({
  tenant,
  userId,
  productCode,
  payload,
  ipAddress,
}) =>
  runTransaction(
    {
      tenant,
      userId,
    },
    async (context) => {
      const { Product, StockMovement } = context.models;

      const product = await Product.findOne({
        tenantId: context.tenantId,

        productCode: normalizeProductCode(productCode),

        isDeleted: false,
      }).session(context.session);

      if (!product) {
        throw createError("Product not found", 404);
      }

      const input = payload || {};

      if (!EDITABLE_FIELDS.some((field) => hasOwn(input, field))) {
        throw createError("Provide at least one editable product field");
      }

      const oldData = product.toObject();

      const updates = buildProductFields(input);

      if (hasOwn(input, "category")) {
        updates.category = await resolveProductCategory({
          models: context.models,

          tenantId: context.tenantId,

          value: input.category,

          session: context.session,

          existingCategory: product.category,

          preserveExisting: true,
        });
      }

      if (hasOwn(input, "brand")) {
        updates.brand = await resolveProductBrand({
          models: context.models,

          tenantId: context.tenantId,

          value: input.brand,

          session: context.session,

          existingBrand: product.brand,

          preserveExisting: true,
        });
      }

      if (hasOwn(input, "unit")) {
        updates.unit = await resolveProductUnit({
          models: context.models,

          tenantId: context.tenantId,

          value: input.unit,

          session: context.session,

          existingUnit: product.unit,

          preserveExisting: true,
        });
      }

      if (hasOwn(input, "hsnSacCode")) {
        updates.hsnSacCode = await resolveHsnSacCode({
          models: context.models,

          tenantId: context.tenantId,

          value: input.hsnSacCode,

          session: context.session,

          existingCode: product.hsnSacCode,

          preserveExisting: true,
        });
      }

      if (hasOwn(input, "gstRate")) {
        updates.gstRate = await resolveTaxRate({
          models: context.models,

          tenantId: context.tenantId,

          value: input.gstRate,

          session: context.session,

          existingRate: product.gstRate,

          preserveExisting: true,
        });
      }

      const nextType = updates.type ?? product.type;

      const nextUnit = updates.unit ?? product.unit;

      const nextTrackInventory =
        nextType === "SERVICE"
          ? false
          : (updates.trackInventory ?? product.trackInventory);

      const stockStructureChanged =
        nextType !== product.type ||
        nextUnit !== product.unit ||
        nextTrackInventory !== product.trackInventory;

      if (stockStructureChanged) {
        const hasMovements = await StockMovement.exists({
          tenantId: context.tenantId,

          productId: product._id,
        }).session(context.session);

        if (hasMovements || Number(product.currentStock) !== 0) {
          throw createError(
            "Product type, unit, and inventory tracking cannot be changed after stock activity",
            409,
          );
        }
      }

      updates.trackInventory = nextTrackInventory;

      product.set(updates);

      if (product.type === "SERVICE") {
        product.trackInventory = false;

        product.reorderLevel = 0;
      }

      await product.save({
        session: context.session,
      });

      await createAudit({
        context,
        product,
        action: "UPDATE",
        oldData,
        ipAddress,
      });

      return product;
    },
  );

const deleteProduct = async ({ tenant, userId, productCode, ipAddress }) =>
  runTransaction(
    {
      tenant,
      userId,
    },
    async (context) => {
      const product = await context.models.Product.findOne({
        tenantId: context.tenantId,

        productCode: normalizeProductCode(productCode),

        isDeleted: false,
      }).session(context.session);

      if (!product) {
        throw createError("Product not found", 404);
      }

      const oldData = product.toObject();

      product.isDeleted = true;
      product.deletedAt = new Date();
      product.deletedBy = context.userId;
      product.status = "INACTIVE";

      await product.save({
        session: context.session,
      });

      await createAudit({
        context,
        product,
        action: "DELETE",
        oldData,
        ipAddress,
      });

      return product;
    },
  );

module.exports = {
  createProduct,
  importProducts,
  getProducts,
  getProductByCode,
  updateProduct,
  deleteProduct,
};
