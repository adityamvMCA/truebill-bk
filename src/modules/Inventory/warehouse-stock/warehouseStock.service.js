const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const resolveContext = (tenant) => {
  if (!tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of [
    "WarehouseStock",
    "Warehouse",
    "Product",
    "InventorySettings",
  ]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  return {
    connection,
    models,

    tenantId: objectId(tenant._id, "tenantId"),
  };
};

const requireWarehouseTracking = async (context) => {
  const settings = await context.models.InventorySettings.findOne({
    tenantId: context.tenantId,
  })
    .select(
      "defaultWarehouseId multiWarehouseEnabled warehouseTrackingStatus warehouseTrackingStartedAt",
    )
    .lean();

  if (!settings) {
    throw createError(
      "Warehouse settings are missing. Provision this tenant first.",
      409,
    );
  }

  if (
    settings.warehouseTrackingStatus !== "READY" ||
    !settings.warehouseTrackingStartedAt
  ) {
    throw createError(
      "Warehouse stock tracking is not initialized. Existing inventory remains available through the Product stock reports.",
      409,
    );
  }

  const defaultWarehouse = await context.models.Warehouse.exists({
    _id: settings.defaultWarehouseId,
    tenantId: context.tenantId,
    status: "ACTIVE",
  });

  if (!defaultWarehouse) {
    throw createError("Default warehouse is missing or inactive", 409);
  }

  return settings;
};

const resolvePagination = (args) => {
  const page = Number(args.page ?? 1);
  const limit = Number(args.limit ?? 20);

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createError("Invalid pagination");
  }

  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw createError("Pagination offset exceeds the supported range");
  }

  return {
    page,
    limit,
    skip,
  };
};

const resolveIncludeZero = (value) => {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "boolean") {
    throw createError("includeZero must be a boolean");
  }

  return value;
};

const loadProduct = async (context, productCode) => {
  const code = normalizeCode(productCode);

  if (!code || code.length > 100 || ["NULL", "UNDEFINED"].includes(code)) {
    throw createError("A valid product code is required");
  }

  const product = await context.models.Product.findOne({
    tenantId: context.tenantId,
    productCode: code,
  })
    .select(
      "_id productCode name unit type trackInventory status isDeleted currentStock",
    )
    .lean();

  if (!product) {
    throw createError("Product not found", 404);
  }

  return product;
};

const loadWarehouse = async (context, warehouseId) => {
  const id = objectId(warehouseId, "warehouseId");

  const warehouse = await context.models.Warehouse.findOne({
    _id: id,
    tenantId: context.tenantId,
  })
    .select("_id warehouseCode name status")
    .lean();

  if (!warehouse) {
    throw createError("Warehouse not found", 404);
  }

  return warehouse;
};

const attachDetails = async (context, records) => {
  if (!records.length) {
    return [];
  }

  const productIds = [
    ...new Set(records.map((record) => String(record.productId))),
  ];

  const warehouseIds = [
    ...new Set(records.map((record) => String(record.warehouseId))),
  ];

  const [products, warehouses] = await Promise.all([
    context.models.Product.find({
      tenantId: context.tenantId,
      _id: {
        $in: productIds,
      },
    })
      .select("_id productCode name unit type trackInventory status isDeleted")
      .lean(),

    context.models.Warehouse.find({
      tenantId: context.tenantId,
      _id: {
        $in: warehouseIds,
      },
    })
      .select("_id warehouseCode name status")
      .lean(),
  ]);

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const warehouseMap = new Map(
    warehouses.map((warehouse) => [String(warehouse._id), warehouse]),
  );

  return records.map((record) => {
    const product = productMap.get(String(record.productId));

    const warehouse = warehouseMap.get(String(record.warehouseId));

    return {
      ...record,
      product: product ?? null,
      warehouse: warehouse ?? null,

      missingProduct: !product,
      missingWarehouse: !warehouse,
    };
  });
};

const queryBalances = async (context, filter, pagination) => {
  const { page, limit, skip } = pagination;

  const [records, total] = await Promise.all([
    context.models.WarehouseStock.find(filter)
      .sort({
        warehouseId: 1,
        productId: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    context.models.WarehouseStock.countDocuments(filter),
  ]);

  const data = await attachDetails(context, records);

  return {
    data,

    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const listWarehouseStock = async (args) => {
  const context = resolveContext(args.tenant);

  await requireWarehouseTracking(context);

  const pagination = resolvePagination(args);

  const includeZero = resolveIncludeZero(args.includeZero);

  const filter = {
    tenantId: context.tenantId,
  };

  if (args.warehouseId) {
    const warehouse = await loadWarehouse(context, args.warehouseId);

    filter.warehouseId = warehouse._id;
  }

  if (args.productCode) {
    const product = await loadProduct(context, args.productCode);

    filter.productId = product._id;
  }

  if (!includeZero) {
    filter.currentStock = {
      $gt: 0,
    };
  }

  return queryBalances(context, filter, pagination);
};

const getProductWarehouseStock = async (args) => {
  const context = resolveContext(args.tenant);

  await requireWarehouseTracking(context);

  const pagination = resolvePagination(args);

  const includeZero = resolveIncludeZero(args.includeZero);

  const product = await loadProduct(context, args.productCode);

  const filter = {
    tenantId: context.tenantId,
    productId: product._id,
  };

  if (!includeZero) {
    filter.currentStock = {
      $gt: 0,
    };
  }

  const result = await queryBalances(context, filter, pagination);

  return {
    product,
    ...result,
  };
};

module.exports = {
  listWarehouseStock,
  getProductWarehouseStock,
};
