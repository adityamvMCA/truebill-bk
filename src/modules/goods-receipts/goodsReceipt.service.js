const mongoose = require("mongoose");
const crypto = require("crypto");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const {
  createStockMovement,
} = require("../stock-movements/stockMovement.service");

const text = (value) => String(value ?? "").trim() || null;

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

const milli = (value) => {
  const scaled = value * 1000;
  const rounded = Math.round(scaled);

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0.001 ||
    value > 1000000 ||
    !Number.isSafeInteger(rounded) ||
    Math.abs(scaled - rounded) > 0.000001
  ) {
    throw createError("Invalid received quantity");
  }

  return rounded;
};

const safe = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError("Value exceeds the supported range");
  }

  return value;
};

const divideRounded = (numerator, denominator) => {
  if (denominator <= 0n) {
    throw createError("Invalid rate calculation divisor");
  }

  return safe(Number((numerator + denominator / 2n) / denominator));
};

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
};

const hashPayload = (payload) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");

const publicReceipt = (value) => {
  const result = value.toObject ? value.toObject() : { ...value };

  delete result.requestHash;

  return result;
};

const resolveContext = (args) => {
  const connection = getReadyTenantConnection(args.tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "GoodsReceipt",
    "PurchaseOrder",
    "Supplier",
    "Product",
    "StockMovement",
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

const createAudit = async (
  context,
  module,
  document,
  action,
  oldData = null,
) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        module,
        action,
        documentId: document._id,
        oldData,
        newData: document.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session },
  );
};

const buildReceipt = async (context, payload) => {
  if (!["DIRECT", "PURCHASE_ORDER"].includes(payload.creationMode)) {
    throw createError("Invalid receipt creation mode");
  }

  const receiptDate = new Date(payload.receiptDate);

  if (!payload.receiptDate || Number.isNaN(receiptDate.getTime())) {
    throw createError("A valid receipt date is required");
  }

  let order = null;
  let oldOrderData = null;
  let receivedMap = new Map();

  if (payload.creationMode === "PURCHASE_ORDER") {
    order = await context.models.PurchaseOrder.findOne({
      _id: objectId(payload.sourceOrderId, "sourceOrderId"),
      tenantId: context.tenantId,
      status: { $in: ["CREATED", "PARTIALLY_RECEIVED"] },
    }).session(context.session);

    if (!order) {
      throw createError("Receivable Purchase Order not found", 409);
    }

    if (
      !Number.isSafeInteger(payload.sourceOrderVersion) ||
      payload.sourceOrderVersion < 0 ||
      order.__v !== payload.sourceOrderVersion
    ) {
      throw createError("Purchase Order changed. Reload it.", 409);
    }

    if (receiptDate < order.orderDate) {
      throw createError("Receipt date cannot precede order date");
    }

    oldOrderData = order.toObject();

    const previous = await context.models.GoodsReceipt.aggregate([
      {
        $match: {
          tenantId: context.tenantId,
          sourceOrderId: order._id,
          status: "CREATED",
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.orderLineId",
          quantityMilli: {
            $sum: {
              $round: [{ $multiply: ["$items.quantity", 1000] }, 0],
            },
          },
        },
      },
    ]).session(context.session);

    receivedMap = new Map(
      previous.map((record) => [
        String(record._id),
        safe(record.quantityMilli),
      ]),
    );
  }

  const supplierId = order
    ? order.supplierId
    : objectId(payload.supplierId, "supplierId");

  const supplier = await context.models.Supplier.findOne({
    _id: supplierId,
    tenantId: context.tenantId,
    status: "Active",
    isDeleted: false,
  })
    .session(context.session)
    .lean();

  if (!supplier) {
    throw createError("Active supplier not found", 404);
  }

  const orderLines = new Map(
    (order?.items || []).map((item) => [String(item.lineId), item]),
  );

  const entries = payload.items.map((input) => {
    let source = null;

    if (order) {
      const key = String(objectId(input.orderLineId, "orderLineId"));
      source = orderLines.get(key);

      if (!source) {
        throw createError("Receipt line does not belong to this order");
      }
    }

    return {
      input,
      source,
      productId: source
        ? source.productId
        : objectId(input.productId, "productId"),
    };
  });

  const productIds = [
    ...new Set(entries.map((entry) => String(entry.productId))),
  ];

  const products = await context.models.Product.find({
    tenantId: context.tenantId,
    _id: { $in: productIds },
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(context.session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError("One or more receipt products are unavailable", 409);
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const seen = new Set();

  const items = entries.map(({ input, source, productId }) => {
    const product = productMap.get(String(productId));
    const quantityMilli = milli(input.quantity);

    const key = source ? String(source.lineId) : String(product._id);

    if (seen.has(key)) {
      throw createError("A receipt source line/product cannot appear twice");
    }

    seen.add(key);

    if (
      source &&
      (source.productType !== product.type || source.unit !== product.unit)
    ) {
      throw createError(
        "Product type or unit changed since order creation",
        409,
      );
    }

    if (source) {
      const alreadyReceived = receivedMap.get(key) || 0;
      const nextReceived = safe(alreadyReceived + quantityMilli);

      if (nextReceived > milli(source.quantity)) {
        throw createError(
          `Over-receipt is not allowed for ${source.productName}`,
          409,
        );
      }

      receivedMap.set(key, nextReceived);
    }

    let estimatedUnitRatePaise;

    if (source) {
      const discountBasisPoints = Math.round(source.discountPercent * 100);

      estimatedUnitRatePaise = divideRounded(
        BigInt(safe(source.unitRatePaise)) *
          BigInt(10000 - discountBasisPoints),
        10000n,
      );
    } else {
      estimatedUnitRatePaise = safe(input.estimatedUnitRatePaise);

      if (estimatedUnitRatePaise > 100000000000) {
        throw createError("Estimated rate exceeds the supported range");
      }
    }

    return {
      lineId: new mongoose.Types.ObjectId(),
      orderLineId: source?.lineId || null,

      productId: product._id,
      productCode: source?.productCode || product.productCode,
      productName: source?.productName || product.name,
      productType: product.type,

      trackInventory:
        product.type === "GOODS" && Boolean(product.trackInventory),

      unit: product.unit,
      quantity: quantityMilli / 1000,
      estimatedUnitRatePaise,
      notes: text(input.notes),
    };
  });

  return {
    order,
    oldOrderData,
    receivedMap,

    data: {
      creationMode: payload.creationMode,
      receiptDate,
      supplierId: supplier._id,
      supplierCode: supplier.supplierCode,
      supplierName: supplier.supplierName,
      sourceOrderId: order?._id || null,
      sourceOrderNumber: order?.orderNumber || null,
      supplierDeliveryReference: text(payload.supplierDeliveryReference),
      items,
      notes: text(payload.notes),
    },
  };
};

const createReceipt = async (args) => {
  const context = resolveContext(args);
  context.userId = objectId(args.userId, "userId");

  const payload = args.payload;
  const requestHash = hashPayload(payload);

  const session = await context.connection.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const tx = { ...context, session };

      const existing = await tx.models.GoodsReceipt.findOne({
        tenantId: tx.tenantId,
        requestId: payload.requestId,
      })
        .session(session)
        .lean();

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw createError(
            "requestId was already used with a different payload",
            409,
          );
        }

        result = {
          replayed: true,
          receipt: publicReceipt(existing),
        };

        return;
      }

      const built = await buildReceipt(tx, payload);

      const receiptNumber = await getNextSequence(
        "GRN",
        String(tx.tenantId),
        3,
        {
          connection: tx.connection,
          session,
        },
      );

      const [receipt] = await tx.models.GoodsReceipt.create(
        [
          {
            ...built.data,
            tenantId: tx.tenantId,
            receiptNumber,
            requestId: payload.requestId,
            requestHash,
            status: "CREATED",
            stockMovementIds: [],
            createdBy: tx.userId,
          },
        ],
        { session },
      );

      // Aggregate repeated products from different PO lines
      // to match the existing StockMovement unique index.
      const groups = new Map();

      for (const item of receipt.items) {
        if (!item.trackInventory) continue;

        const key = String(item.productId);

        const group = groups.get(key) || {
          productId: item.productId,
          quantityMilli: 0,
          weightedRate: 0n,
        };

        const quantityMilli = milli(item.quantity);

        group.quantityMilli = safe(group.quantityMilli + quantityMilli);

        group.weightedRate +=
          BigInt(item.estimatedUnitRatePaise) * BigInt(quantityMilli);

        groups.set(key, group);
      }

      for (const group of groups.values()) {
        const ratePaise = divideRounded(
          group.weightedRate,
          BigInt(group.quantityMilli),
        );

        const movementResult = await createStockMovement({
          tenant: tx.tenant,
          connection: tx.connection,
          userId: tx.userId,
          productId: group.productId,
          movementType: "GOODS_RECEIPT",
          quantity: group.quantityMilli / 1000,
          unitRate: ratePaise / 100,
          referenceType: "GOODS_RECEIPT",
          referenceId: receipt._id,
          referenceNumber: receipt.receiptNumber,
          movementDate: receipt.receiptDate,
          notes: `Goods receipt ${receipt.receiptNumber}`,
          session,
        });

        receipt.stockMovementIds.push(movementResult.movement._id);
      }

      await receipt.save({ session });

      if (built.order) {
        const complete = built.order.items.every((item) => {
          const received = built.receivedMap.get(String(item.lineId)) || 0;

          return received === milli(item.quantity);
        });

        built.order.status = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";

        built.order.updatedBy = tx.userId;

        // Optimistic concurrency on the existing PO model
        // protects against concurrent receipts/cancellation.
        await built.order.save({ session });

        await createAudit(
          tx,
          "PURCHASEORDER",
          built.order,
          "UPDATE",
          built.oldOrderData,
        );
      }

      await createAudit(tx, "GOODSRECEIPT", receipt, "CREATE");

      result = {
        replayed: false,
        receipt: publicReceipt(receipt),
      };
    });

    return result;
  } catch (error) {
    if (error.name === "VersionError") {
      throw createError("Purchase Order changed. Reload and retry.", 409);
    }

    if (error.code === 11000) {
      const existing = await context.models.GoodsReceipt.findOne({
        tenantId: context.tenantId,
        requestId: payload.requestId,
      }).lean();

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw createError(
            "requestId was already used with a different payload",
            409,
          );
        }

        return {
          replayed: true,
          receipt: publicReceipt(existing),
        };
      }

      throw createError("Duplicate receipt or stock reference", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const listReceipts = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const { page = 1, limit = 20, creationMode } = args;
  const filter = { tenantId };

  if (creationMode) filter.creationMode = creationMode;

  for (const field of ["supplierId", "sourceOrderId"]) {
    if (args[field]) {
      filter[field] = objectId(args[field], field);
    }
  }

  const [data, total] = await Promise.all([
    models.GoodsReceipt.find(filter)
      .select("-requestHash")
      .sort({ receiptDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    models.GoodsReceipt.countDocuments(filter),
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

const getReceipt = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const receipt = await models.GoodsReceipt.findOne({
    tenantId,
    receiptNumber: String(args.receiptNumber).trim().toUpperCase(),
  })
    .select("-requestHash")
    .lean();

  if (!receipt) {
    throw createError("Goods Receipt not found", 404);
  }

  return receipt;
};

module.exports = {
  createReceipt,
  listReceipts,
  getReceipt,
};
