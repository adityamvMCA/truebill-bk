const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const MOVEMENT_RULES = {
  OPENING: {
    direction: "IN",
    referenceType: "OPENING",
  },

  PURCHASE: {
    direction: "IN",
    referenceType: "PURCHASE_BILL",
  },

  PURCHASE_RETURN: {
    direction: "OUT",
    referenceType: "PURCHASE_RETURN",
  },

  SALE: {
    direction: "OUT",
    referenceType: "SALES_INVOICE",
  },

  DELIVERY: {
    direction: "OUT",
    referenceType: "DELIVERY_NOTE",
  },

  SALES_RETURN: {
    direction: "IN",
    referenceType: "SALES_RETURN",
  },

  ADJUSTMENT_IN: {
    direction: "IN",
    referenceType: "STOCK_ADJUSTMENT",
  },

  ADJUSTMENT_OUT: {
    direction: "OUT",
    referenceType: "STOCK_ADJUSTMENT",
  },

  GOODS_RECEIPT: {
    direction: "IN",
    referenceType: "GOODS_RECEIPT",
  },

  TRANSFER_IN: {
    direction: "IN",
    referenceType: "STOCK_TRANSFER",
  },

  TRANSFER_OUT: {
    direction: "OUT",
    referenceType: "STOCK_TRANSFER",
  },
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const scaledInteger = ({ value, label, scale, minimum = 0, maximum }) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw createError(`${label} must be between ${minimum} and ${maximum}`);
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
    throw createError(
      `${label} has too many decimal places or exceeds the supported range`,
    );
  }

  return integer;
};

const quantityMilli = (value, label = "Quantity") =>
  scaledInteger({
    value,
    label,
    scale: 1000,
    minimum: 0.001,
    maximum: 1000000,
  });

const balanceMilli = (value, label = "Stock balance") =>
  scaledInteger({
    value,
    label,
    scale: 1000,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER / 1000,
  });

const ratePaise = (value) =>
  scaledInteger({
    value,
    label: "Unit rate",
    scale: 100,
    minimum: 0,
    maximum: 1000000000,
  });

const calculateValue = (quantityMilliValue, unitRatePaise) => {
  const numerator = BigInt(quantityMilliValue) * BigInt(unitRatePaise);

  const valuePaise = (numerator + 500n) / 1000n;

  if (valuePaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createError("Stock movement value exceeds the supported range");
  }

  return Number(valuePaise) / 100;
};

const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);

  if (args.connection && args.connection !== connection) {
    throw createError(
      "Stock movement connection does not match the tenant connection",
      500,
    );
  }

  const models = getTenantAccountingModels(connection);

  for (const name of [
    "Product",
    "StockMovement",
    "Warehouse",
    "WarehouseStock",
    "InventorySettings",
    "AuditLog",
  ]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  return {
    ...args,
    connection,
    models,
    tenantId: objectId(args.tenant._id, "tenantId"),
  };
};

const translateError = (error) => {
  if (error.code === 11000) {
    return createError(
      "A stock movement or stock balance with this unique reference already exists",
      409,
    );
  }

  if (error.name === "VersionError") {
    return createError("Stock changed. Reload before continuing.", 409);
  }

  return error;
};

const runTransaction = async (args, operation) => {
  const context = resolveContext(args);

  context.userId = objectId(args.userId, "userId");

  if (args.session) {
    if (!args.session.inTransaction()) {
      throw createError(
        "The supplied stock session must have an active transaction",
        500,
      );
    }

    return operation({
      ...context,
      session: args.session,
    });
  }

  const session = await context.connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({
        ...context,
        session,
      });
    });

    return result;
  } catch (error) {
    throw translateError(error);
  } finally {
    await session.endSession();
  }
};

const lockInventorySettings = async (context) => {
  const settings = await context.models.InventorySettings.findOneAndUpdate(
    {
      tenantId: context.tenantId,
    },
    {
      $inc: {
        __v: 1,
      },
    },
    {
      new: true,
      session: context.session,
      timestamps: false,
    },
  ).lean();

  if (!settings) {
    throw createError(
      "Inventory settings are missing. Provision the tenant warehouses first.",
      409,
    );
  }

  if (
    !["NOT_INITIALIZED", "READY"].includes(settings.warehouseTrackingStatus)
  ) {
    throw createError("Invalid warehouse tracking status", 409);
  }

  if (
    settings.multiWarehouseEnabled &&
    settings.warehouseTrackingStatus !== "READY"
  ) {
    throw createError(
      "Multiple warehouses cannot be used before stock initialization",
      409,
    );
  }

  if (
    settings.warehouseTrackingStatus === "READY" &&
    !settings.warehouseTrackingStartedAt
  ) {
    throw createError("Warehouse tracking start time is missing", 409);
  }

  return settings;
};

const resolveWarehouse = async (context, settings) => {
  if (settings.warehouseTrackingStatus !== "READY") {
    if (context.warehouseId != null) {
      throw createError("Warehouse stock tracking is not initialized", 409);
    }

    return null;
  }

  let warehouseId;

  if (settings.multiWarehouseEnabled) {
    if (!context.warehouseId) {
      throw createError("Select a warehouse for this stock movement");
    }

    warehouseId = objectId(context.warehouseId, "warehouseId");
  } else {
    warehouseId = objectId(settings.defaultWarehouseId, "defaultWarehouseId");

    if (
      context.warehouseId != null &&
      String(objectId(context.warehouseId, "warehouseId")) !==
        String(warehouseId)
    ) {
      throw createError(
        "Only the default location can be used while multi-warehouse mode is disabled",
        409,
      );
    }
  }

  const warehouse = await context.models.Warehouse.findOne({
    _id: warehouseId,
    tenantId: context.tenantId,
    status: "ACTIVE",
  })
    .session(context.session)
    .lean();

  if (!warehouse) {
    throw createError("Active warehouse not found", 404);
  }

  const locked = await context.models.Warehouse.updateOne(
    {
      _id: warehouse._id,
      tenantId: context.tenantId,
      status: "ACTIVE",
      __v: warehouse.__v,
    },
    {
      $inc: {
        __v: 1,
      },
    },
    {
      session: context.session,
      timestamps: false,
    },
  );

  if (locked.modifiedCount !== 1) {
    throw createError("Warehouse changed. Reload before continuing.", 409);
  }

  return warehouse;
};

const loadProduct = async (context, filter) => {
  const product = await context.models.Product.findOne({
    ...filter,
    tenantId: context.tenantId,
    isDeleted: false,
  }).session(context.session);

  if (!product) {
    throw createError("Product not found", 404);
  }

  if (product.type !== "GOODS" || product.trackInventory !== true) {
    throw createError(
      "Stock movement is allowed only for inventory-tracked Goods products",
      409,
    );
  }

  return product;
};

const writeMovement = async (context) => {
  const movementType = normalizeCode(context.movementType);

  const rule = MOVEMENT_RULES[movementType];

  if (!rule) {
    throw createError("Invalid stock movement type");
  }

  if (["TRANSFER_IN", "TRANSFER_OUT"].includes(movementType)) {
    throw createError(
      "Transfers must use the dedicated paired stock-transfer workflow",
      409,
    );
  }

  const referenceType = context.referenceType ?? rule.referenceType;

  if (referenceType !== rule.referenceType) {
    throw createError("Reference type does not match the stock movement type");
  }

  const quantityInteger = quantityMilli(context.quantity);

  const unitRateInteger = ratePaise(context.unitRate ?? 0);

  const movementDate =
    context.movementDate == null ? new Date() : new Date(context.movementDate);

  if (Number.isNaN(movementDate.getTime())) {
    throw createError("A valid movement date is required");
  }

  const notes = normalizeText(context.notes) || null;

  if (notes && notes.length > 500) {
    throw createError("Stock movement notes cannot exceed 500 characters");
  }

  const referenceId =
    context.referenceId == null
      ? null
      : objectId(context.referenceId, "referenceId");

  const settings = await lockInventorySettings(context);

  const warehouse = await resolveWarehouse(context, settings);

  const product = await loadProduct(context, {
    _id: objectId(context.productId, "productId"),
  });

  if (movementType === "OPENING") {
    const existing = await context.models.StockMovement.exists({
      tenantId: context.tenantId,
      productId: product._id,
    }).session(context.session);

    if (existing) {
      throw createError(
        "Opening stock cannot be posted after stock movement history exists",
        409,
      );
    }
  }

  const aggregateBefore = balanceMilli(product.currentStock, "Product stock");

  let warehouseStock = null;

  let locationBefore = aggregateBefore;

  if (warehouse) {
    warehouseStock = await context.models.WarehouseStock.findOne({
      tenantId: context.tenantId,
      warehouseId: warehouse._id,
      productId: product._id,
    }).session(context.session);

    locationBefore = warehouseStock
      ? balanceMilli(warehouseStock.currentStock, "Warehouse stock")
      : 0;
  }

  const delta = rule.direction === "IN" ? quantityInteger : -quantityInteger;

  const locationAfter = locationBefore + delta;

  const aggregateAfter = aggregateBefore + delta;

  if (locationAfter < 0 || aggregateAfter < 0) {
    throw createError(
      `Insufficient stock. Available quantity at this location is ${locationBefore / 1000}.`,
      409,
    );
  }

  if (
    !Number.isSafeInteger(locationAfter) ||
    !Number.isSafeInteger(aggregateAfter)
  ) {
    throw createError("Stock balance exceeds the supported range", 409);
  }

  if (warehouse) {
    if (warehouseStock) {
      warehouseStock.currentStock = locationAfter / 1000;

      await warehouseStock.save({
        session: context.session,
      });
    } else {
      const [createdBalance] = await context.models.WarehouseStock.create(
        [
          {
            tenantId: context.tenantId,
            warehouseId: warehouse._id,
            productId: product._id,
            currentStock: locationAfter / 1000,
          },
        ],
        {
          session: context.session,
        },
      );

      warehouseStock = createdBalance;
    }
  }

  product.currentStock = aggregateAfter / 1000;

  await product.save({
    session: context.session,
  });

  const [movement] = await context.models.StockMovement.create(
    [
      {
        tenantId: context.tenantId,
        warehouseId: warehouse?._id ?? null,

        productId: product._id,
        productCode: product.productCode,

        movementType,
        direction: rule.direction,

        quantity: quantityInteger / 1000,

        unitRate: unitRateInteger / 100,

        totalValue: calculateValue(quantityInteger, unitRateInteger),

        stockBefore: locationBefore / 1000,

        stockAfter: locationAfter / 1000,

        aggregateStockBefore: aggregateBefore / 1000,

        aggregateStockAfter: aggregateAfter / 1000,

        referenceType,
        referenceId,

        referenceNumber: normalizeCode(context.referenceNumber) || null,

        movementDate,
        notes,
        createdBy: context.userId,
      },
    ],
    {
      session: context.session,
    },
  );

  return {
    product,
    movement,
    warehouseStock,
  };
};

const createStockMovement = async (args) => runTransaction(args, writeMovement);

const getStockMovements = async (args) => {
  const context = resolveContext(args);

  const page = Number(args.page ?? 1);
  const limit = Number(args.limit ?? 50);

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

  const filter = {
    tenantId: context.tenantId,
  };

  if (args.productCode) {
    filter.productCode = normalizeCode(args.productCode);
  }

  if (args.warehouseId) {
    filter.warehouseId = objectId(args.warehouseId, "warehouseId");
  }

  if (args.movementType) {
    const movementType = normalizeCode(args.movementType);

    if (!MOVEMENT_RULES[movementType]) {
      throw createError("Invalid stock movement type");
    }

    filter.movementType = movementType;
  }

  if (args.direction) {
    const direction = normalizeCode(args.direction);

    if (!["IN", "OUT"].includes(direction)) {
      throw createError("Direction must be IN or OUT");
    }

    filter.direction = direction;
  }

  const [data, total] = await Promise.all([
    context.models.StockMovement.find(filter)
      .sort({
        movementDate: -1,
        createdAt: -1,
        _id: -1,
      })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "productId",
        match: {
          tenantId: context.tenantId,
        },
        select: "productCode name unit",
      })
      .populate({
        path: "warehouseId",
        match: {
          tenantId: context.tenantId,
        },
        select: "warehouseCode name",
      })
      .lean(),

    context.models.StockMovement.countDocuments(filter),
  ]);

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

const createManualAdjustment = async (args) =>
  runTransaction(args, async (context) => {
    const adjustmentType = normalizeCode(args.adjustmentType);

    if (!["ADJUSTMENT_IN", "ADJUSTMENT_OUT"].includes(adjustmentType)) {
      throw createError(
        "adjustmentType must be ADJUSTMENT_IN or ADJUSTMENT_OUT",
      );
    }

    const productCode = normalizeCode(args.productCode);

    if (!productCode || ["NULL", "UNDEFINED"].includes(productCode)) {
      throw createError("A valid product code is required");
    }

    const product = await loadProduct(context, {
      productCode,
    });

    const oldData = product.toObject();

    const result = await writeMovement({
      ...context,
      productId: product._id,
      movementType: adjustmentType,
      referenceType: "STOCK_ADJUSTMENT",

      referenceNumber: `ADJ-${new mongoose.Types.ObjectId()}`,
    });

    await context.models.AuditLog.create(
      [
        {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "STOCK_ADJUSTMENT",
          module: "PRODUCT",
          documentId: product._id,
          oldData,
          newData: result.product.toObject(),
          ipAddress: context.ipAddress,
        },
      ],
      {
        session: context.session,
      },
    );

    return result;
  });

const backfillOpeningStock = async (args) =>
  runTransaction(args, async (context) => {
    const settings = await lockInventorySettings(context);

    if (settings.warehouseTrackingStatus === "READY") {
      throw createError(
        "Legacy opening backfill is disabled after warehouse tracking starts. Use a reconciled stock correction instead.",
        409,
      );
    }

    const productCode = normalizeCode(args.productCode);

    if (!productCode || ["NULL", "UNDEFINED"].includes(productCode)) {
      throw createError("A valid product code is required");
    }

    const product = await loadProduct(context, {
      productCode,
    });

    const existingMovement = await context.models.StockMovement.exists({
      tenantId: context.tenantId,
      productId: product._id,
    }).session(context.session);

    if (existingMovement) {
      throw createError(
        "Opening backfill is blocked because stock movement history exists. Reconcile this product before changing its opening history.",
        409,
      );
    }

    const openingInteger = quantityMilli(product.openingStock, "Opening stock");

    const currentInteger = balanceMilli(product.currentStock, "Current stock");

    if (currentInteger !== 0 && currentInteger !== openingInteger) {
      throw createError(
        "Current stock does not match zero or opening stock. Reconciliation is required.",
        409,
      );
    }

    const oldData = product.toObject();

    let result;

    if (currentInteger === 0) {
      result = await writeMovement({
        ...context,
        productId: product._id,
        movementType: "OPENING",
        quantity: openingInteger / 1000,
        unitRate: product.openingStockRate,
        referenceType: "OPENING",
        referenceId: product._id,

        referenceNumber: `OPEN-${product.productCode}`,

        movementDate: new Date(),

        notes: "Opening stock applied by controlled backfill",
      });
    } else {
      const unitRateInteger = ratePaise(product.openingStockRate);

      const [movement] = await context.models.StockMovement.create(
        [
          {
            tenantId: context.tenantId,
            warehouseId: null,

            productId: product._id,
            productCode: product.productCode,

            movementType: "OPENING",
            direction: "IN",

            quantity: openingInteger / 1000,

            unitRate: unitRateInteger / 100,

            totalValue: calculateValue(openingInteger, unitRateInteger),

            stockBefore: 0,
            stockAfter: openingInteger / 1000,

            aggregateStockBefore: 0,
            aggregateStockAfter: openingInteger / 1000,

            referenceType: "OPENING",
            referenceId: product._id,

            referenceNumber: `OPEN-${product.productCode}`,

            movementDate: new Date(),

            notes:
              "Historical opening entry backfilled; existing Product stock was not increased",

            createdBy: context.userId,
          },
        ],
        {
          session: context.session,
        },
      );

      product.increment();

      await product.save({
        session: context.session,
      });

      result = {
        product,
        movement,
        warehouseStock: null,
      };
    }

    await context.models.AuditLog.create(
      [
        {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "OPENING_STOCK_BACKFILL",
          module: "PRODUCT",
          documentId: product._id,
          oldData,
          newData: result.product.toObject(),
          ipAddress: context.ipAddress,
        },
      ],
      {
        session: context.session,
      },
    );

    return result;
  });

module.exports = {
  createStockMovement,
  getStockMovements,
  createManualAdjustment,
  backfillOpeningStock,
};
