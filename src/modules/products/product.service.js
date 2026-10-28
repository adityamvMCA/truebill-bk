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
  createStockMovement,
} = require("../stock-movements/stockMovement.service");

const { normalizeText, runCsvImport } = require("../../utils/csvImport");

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

const assertPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError("Product payload is required");
  }
};

const normalizeProductCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const requireProductCode = (value) => {
  const code = normalizeProductCode(value);

  if (!code || ["NULL", "UNDEFINED"].includes(code)) {
    throw createError("A valid product code is required");
  }

  return code;
};

const cleanNullableText = (value) => normalizeText(value) || null;

const normalizeCategoryName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

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
    throw createError(
      `${label} has too many decimal places or exceeds the supported range`,
    );
  }

  return rounded / scale;
};

const resolveContext = (tenant) => {
  if (!tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  validateObjectId(tenant._id, "tenantId");

  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of ["Product", "StockMovement", "AuditLog"]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

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
      throw createError(
        "A product name, product code, or stock reference already exists",
        409,
      );
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

  if (!session || !session.inTransaction()) {
    throw createError(
      "Category assignment requires an active transaction",
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
    const unit = String(payload.unit ?? "NOS")
      .trim()
      .toUpperCase();

    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(unit)) {
      throw createError("A valid unit code is required");
    }

    fields.unit = unit;
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
      assertPayload(payload);

      const { Product } = context.models;

      const fields = buildProductFields(payload, true);

      if (fields.type === "SERVICE" && fields.trackInventory === true) {
        throw createError("Services cannot track inventory");
      }

      const trackInventory =
        fields.type === "GOODS" && fields.trackInventory === true;

      const openingStock = trackInventory ? fields.openingStock : 0;

      const openingStockRate = trackInventory ? fields.openingStockRate : 0;

      const reorderLevel = trackInventory ? fields.reorderLevel : 0;

      const warehouseId = payload.warehouseId ?? null;

      if (warehouseId !== null) {
        validateObjectId(warehouseId, "warehouseId");

        if (!trackInventory || openingStock <= 0) {
          throw createError(
            "warehouseId is only used when creating inventory-tracked goods with positive opening stock",
          );
        }
      }

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

      const productCode = await getNextSequence(
        "PR",
        String(context.tenantId),
        3,
        {
          connection: context.connection,
          session: context.session,
        },
      );

      let [product] = await Product.create(
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
        const openingResult = await createStockMovement({
          tenant,
          connection: context.connection,

          userId: context.userId,

          productId: product._id,

          warehouseId,

          movementType: "OPENING",

          quantity: openingStock,

          unitRate: openingStockRate,

          referenceType: "OPENING",

          referenceId: product._id,

          referenceNumber: `OPEN-${product.productCode}`,

          movementDate: new Date(),

          notes: "Opening stock at product creation",

          session: context.session,
        });

        product = openingResult.product;
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

const parseCsvNumber = (value, fallback, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw createError(`${label} must be a valid number`);
  }

  return number;
};

const parseCsvBoolean = (value, fallback, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value).trim().toLowerCase();

  if (["true", "yes", "1", "y"].includes(text)) {
    return true;
  }

  if (["false", "no", "0", "n"].includes(text)) {
    return false;
  }

  throw createError(`${label} must be true or false`);
};

const readCsvField = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }

  return undefined;
};

const importProducts = async ({ tenant, userId, buffer, ipAddress }) => {
  resolveContext(tenant);

  validateObjectId(userId, "userId");

  return runCsvImport({
    buffer,

    requiredHeaders: ["name", "type", "unit"],

    maxRows: 500,

    mapRow: (row) => {
      const type = normalizeText(row.type || "GOODS").toUpperCase();

      const trackInventory = parseCsvBoolean(
        readCsvField(
          row,
          "trackInventory",
          "trackinventory",
          "track_inventory",
        ),

        type === "GOODS",

        "trackInventory",
      );

      return {
        name: normalizeText(row.name),

        type,

        category: normalizeText(row.category),

        brand: normalizeText(row.brand),

        description: normalizeText(row.description),

        unit: normalizeText(row.unit || "NOS").toUpperCase(),

        warehouseId:
          normalizeText(
            readCsvField(row, "warehouseId", "warehouseid", "warehouse_id"),
          ) || null,

        hsnSacCode: normalizeText(
          readCsvField(
            row,
            "hsnSacCode",
            "hsnsaccode",
            "hsn_sac_code",
            "hsn_sac",
          ),
        ).toUpperCase(),

        gstRate: parseCsvNumber(
          readCsvField(row, "gstRate", "gstrate", "gst_rate"),
          18,
          "GST rate",
        ),

        salePrice: parseCsvNumber(
          readCsvField(row, "salePrice", "saleprice", "sale_price"),
          0,
          "Sale price",
        ),

        purchasePrice: parseCsvNumber(
          readCsvField(row, "purchasePrice", "purchaseprice", "purchase_price"),
          0,
          "Purchase price",
        ),

        trackInventory,

        openingStock: parseCsvNumber(
          readCsvField(row, "openingStock", "openingstock", "opening_stock"),
          0,
          "Opening stock",
        ),

        openingStockRate: parseCsvNumber(
          readCsvField(
            row,
            "openingStockRate",
            "openingstockrate",
            "opening_stock_rate",
          ),
          0,
          "Opening stock rate",
        ),

        reorderLevel: parseCsvNumber(
          readCsvField(row, "reorderLevel", "reorderlevel", "reorder_level"),
          0,
          "Reorder level",
        ),

        status: normalizeText(row.status || "ACTIVE").toUpperCase(),
      };
    },

    processRow: async (payload) =>
      createProduct({
        tenant,
        userId,
        payload,
        ipAddress,
      }),
  });
};

// const getProducts = async ({
//   tenant,
//   search = "",
//   status,
//   type,
//   category,
//   trackInventory,
//   page = 1,
//   limit = 20,
// }) => {
//   const { models, tenantId } = resolveContext(tenant);

//   const currentPage = Number(page);

//   const pageLimit = Number(limit);

//   if (
//     !Number.isSafeInteger(currentPage) ||
//     currentPage < 1 ||
//     !Number.isSafeInteger(pageLimit) ||
//     pageLimit < 1 ||
//     pageLimit > 100
//   ) {
//     throw createError(
//       "page must be a positive integer and limit must be between 1 and 100",
//     );
//   }

//   const skip = (currentPage - 1) * pageLimit;

//   if (!Number.isSafeInteger(skip)) {
//     throw createError("Pagination offset exceeds the supported range");
//   }

//   const filter = {
//     tenantId,
//     isDeleted: false,
//   };

//   if (status) {
//     const normalizedStatus = String(status).trim().toUpperCase();

//     if (!PRODUCT_STATUS.includes(normalizedStatus)) {
//       throw createError("Invalid product status");
//     }

//     filter.status = normalizedStatus;
//   }

//   if (type) {
//     const normalizedType = String(type).trim().toUpperCase();

//     if (!PRODUCT_TYPES.includes(normalizedType)) {
//       throw createError("Invalid product type");
//     }

//     filter.type = normalizedType;
//   }

//   if (category) {
//     filter.category = normalizeCategoryName(category);
//   }

//   if (
//     trackInventory !== undefined &&
//     trackInventory !== null &&
//     trackInventory !== ""
//   ) {
//     const value = String(trackInventory).trim().toLowerCase();

//     if (!["true", "false"].includes(value)) {
//       throw createError("trackInventory must be true or false");
//     }

//     filter.trackInventory = value === "true";
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

//     const regex = new RegExp(escaped, "i");

//     filter.$or = [
//       { name: regex },
//       { productCode: regex },
//       { hsnSacCode: regex },
//       { category: regex },
//       { brand: regex },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     models.Product.find(filter)
//       .sort({
//         createdAt: -1,
//         _id: -1,
//       })
//       .skip(skip)
//       .limit(pageLimit)
//       .lean(),

//     models.Product.countDocuments(filter),
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

  const currentPage = Number(page);
  const pageLimit = Number(limit);

  if (
    !Number.isSafeInteger(currentPage) ||
    currentPage < 1 ||
    !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 ||
    pageLimit > 100
  ) {
    throw createError(
      "page must be a positive integer and limit must be between 1 and 100"
    );
  }

  const skip = (currentPage - 1) * pageLimit;

  if (!Number.isSafeInteger(skip)) {
    throw createError(
      "Pagination offset exceeds the supported range"
    );
  }

  const baseFilter = {
    tenantId,
    isDeleted: false,
  };

  const filter = { ...baseFilter };

  if (status) {
    const normalizedStatus = String(status)
      .trim()
      .toUpperCase();

    if (!PRODUCT_STATUS.includes(normalizedStatus)) {
      throw createError("Invalid product status");
    }

    filter.status = normalizedStatus;
  }

  if (type) {
    const normalizedType = String(type)
      .trim()
      .toUpperCase();

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
    const value = String(trackInventory)
      .trim()
      .toLowerCase();

    if (!["true", "false"].includes(value)) {
      throw createError(
        "trackInventory must be true or false"
      );
    }

    filter.trackInventory = value === "true";
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const escaped = searchText.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const regex = new RegExp(escaped, "i");

    const searchConditions = [
      { name: regex },
      { productCode: regex },
      { hsnSacCode: regex },
      { category: regex },
      { brand: regex },
    ];

    filter.$or = searchConditions;

    // Quick-filter counts reflect the current search, but
    // don't disappear when a status/type tab is selected.
    baseFilter.$or = searchConditions;
  }

  const [
    data,
    total,
    aggregateCounts,
  ] = await Promise.all([
    models.Product.find(filter)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .skip(skip)
      .limit(pageLimit)
      .lean(),

    models.Product.countDocuments(filter),

    models.Product.aggregate([
      {
        $match: baseFilter,
      },
      {
        $facet: {
          all: [
            { $count: "count" },
          ],
          active: [
            { $match: { status: "ACTIVE" } },
            { $count: "count" },
          ],
          inactive: [
            { $match: { status: "INACTIVE" } },
            { $count: "count" },
          ],
          goods: [
            { $match: { type: "GOODS" } },
            { $count: "count" },
          ],
          services: [
            { $match: { type: "SERVICE" } },
            { $count: "count" },
          ],
        },
      },
    ]),
  ]);

  const result = aggregateCounts[0] || {};

  const readCount = (key) =>
    Number(result[key]?.[0]?.count || 0);

  return {
    data,

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },

    counts: {
      all: readCount("all"),
      active: readCount("active"),
      inactive: readCount("inactive"),
      goods: readCount("goods"),
      services: readCount("services"),
    },
  };
};
const getProductByCode = async ({ tenant, productCode }) => {
  const { models, tenantId } = resolveContext(tenant);

  return models.Product.findOne({
    tenantId,

    productCode: requireProductCode(productCode),

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
      assertPayload(payload);

      const input = payload;

      if (hasOwn(input, "warehouseId")) {
        throw createError(
          "Product stock cannot be moved by changing warehouseId. Use a stock transfer.",
        );
      }

      for (const field of [
        "openingStock",
        "openingStockRate",
        "currentStock",
      ]) {
        if (hasOwn(input, field)) {
          throw createError(`${field} cannot be edited through Product update`);
        }
      }

      if (!EDITABLE_FIELDS.some((field) => hasOwn(input, field))) {
        throw createError("Provide at least one editable product field");
      }

      const { Product, StockMovement } = context.models;

      const product = await Product.findOne({
        tenantId: context.tenantId,

        productCode: requireProductCode(productCode),

        isDeleted: false,
      }).session(context.session);

      if (!product) {
        throw createError("Product not found", 404);
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

      if (nextType === "SERVICE" && updates.trackInventory === true) {
        throw createError("Services cannot track inventory");
      }

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

        const { WarehouseStock } = context.models;

        if (!WarehouseStock || WarehouseStock.db !== context.connection) {
          throw createError(
            "WarehouseStock is not registered on the tenant connection",
            500,
          );
        }

        const hasWarehouseStock = await WarehouseStock.exists({
          tenantId: context.tenantId,

          productId: product._id,

          currentStock: {
            $ne: 0,
          },
        }).session(context.session);

        if (hasWarehouseStock) {
          throw createError(
            "Product inventory settings cannot be changed while warehouse stock exists",
            409,
          );
        }
      }

      updates.trackInventory = nextTrackInventory;

      if (!nextTrackInventory) {
        updates.reorderLevel = 0;
      }

      product.set(updates);

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

        productCode: requireProductCode(productCode),

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
