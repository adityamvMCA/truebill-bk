const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../../utils/sequenceGenerator");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const roundQuantity = (value) => Math.round(Number(value) * 1000) / 1000;

const roundAmount = (value) => Math.round(Number(value) * 100) / 100;

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const nullableText = (value) => String(value ?? "").trim() || null;

const validateObjectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }
};

const resolveContext = (tenant) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of [
    "Product",
    "StockMovement",
    "StockAdjustment",
    "AuditLog",
  ]) {
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

const createStockAdjustment = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
  const context = resolveContext(tenant);

  validateObjectId(userId, "userId");

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError("Stock adjustment payload is required");
  }

  const session = await context.connection.startSession();

  try {
    let adjustment;

    await session.withTransaction(async () => {
      const { Product, StockMovement, StockAdjustment, AuditLog } =
        context.models;

      const productCode = normalizeCode(payload.productCode);

      const product = await Product.findOne({
        tenantId: context.tenantId,

        productCode,

        isDeleted: false,
      }).session(session);

      if (!product) {
        throw createError("Product not found", 404);
      }

      if (product.type !== "GOODS" || product.trackInventory !== true) {
        throw createError(
          "Stock adjustment is allowed only for inventory-tracked goods",
          409,
        );
      }

      const quantity = roundQuantity(payload.quantity);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw createError("Adjustment quantity must be greater than zero");
      }

      const stockBefore = roundQuantity(product.currentStock);

      const adjustmentType = payload.adjustmentType;

      const stockAfter =
        adjustmentType === "INCREASE"
          ? roundQuantity(stockBefore + quantity)
          : roundQuantity(stockBefore - quantity);

      if (stockAfter < 0) {
        throw createError(
          `Insufficient stock. Available quantity is ${stockBefore}.`,
          409,
        );
      }

      const unitRate = roundAmount(payload.unitRate ?? 0);

      const totalValue = roundAmount(quantity * unitRate);

      if (!Number.isSafeInteger(Math.round(totalValue * 100))) {
        throw createError("Adjustment value exceeds the supported range");
      }

      const adjustmentNumber = await getNextSequence(
        "SA",
        String(context.tenantId),
        3,
        {
          connection: context.connection,

          session,
        },
      );

      const [record] = await StockAdjustment.create(
        [
          {
            tenantId: context.tenantId,

            adjustmentNumber,

            productId: product._id,

            productCode: product.productCode,

            adjustmentType,

            quantity,

            unitRate,

            totalValue,

            stockBefore,

            stockAfter,

            reason: payload.reason,

            notes: nullableText(payload.notes),

            adjustmentDate: payload.adjustmentDate ?? new Date(),

            status: "COMPLETED",

            createdBy: userId,
          },
        ],
        {
          session,
        },
      );

      const direction = adjustmentType === "INCREASE" ? "IN" : "OUT";

      const movementType =
        adjustmentType === "INCREASE" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";

      await StockMovement.create(
        [
          {
            tenantId: context.tenantId,

            productId: product._id,

            productCode: product.productCode,

            movementType,

            direction,

            quantity,

            unitRate,

            totalValue,

            stockBefore,

            stockAfter,

            referenceType: "STOCK_ADJUSTMENT",

            referenceId: record._id,

            referenceNumber: record.adjustmentNumber,

            movementDate: record.adjustmentDate,

            notes:
              record.notes ??
              `Stock ${adjustmentType.toLowerCase()} adjustment`,

            createdBy: userId,
          },
        ],
        {
          session,
        },
      );

      product.currentStock = stockAfter;

      await product.save({
        session,
      });

      await AuditLog.create(
        [
          {
            tenantId: context.tenantId,

            userId,

            action: "CREATE",

            module: "STOCK_ADJUSTMENT",

            documentId: record._id,

            newData: record.toObject(),

            ipAddress,
          },
        ],
        {
          session,
        },
      );

      adjustment = record;
    });

    return adjustment;
  } catch (error) {
    if (error.code === 11000) {
      throw createError("Stock adjustment number already exists", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const listStockAdjustments = async ({
  tenant,
  productCode,
  adjustmentType,
  reason,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const { models, tenantId } = resolveContext(tenant);

  const { StockAdjustment } = models;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const skip = (currentPage - 1) * pageLimit;

  if (!Number.isSafeInteger(skip)) {
    throw createError("Pagination offset exceeds the supported range");
  }

  const filter = {
    tenantId,
  };

  if (productCode) {
    filter.productCode = normalizeCode(productCode);
  }

  if (adjustmentType) {
    filter.adjustmentType = adjustmentType;
  }

  if (reason) {
    filter.reason = reason;
  }

  if (fromDate && toDate) {
    filter.adjustmentDate = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
  }

  const [data, total] = await Promise.all([
    StockAdjustment.find(filter)
      .sort({
        adjustmentDate: -1,
        _id: -1,
      })
      .skip(skip)
      .limit(pageLimit)
      .lean(),

    StockAdjustment.countDocuments(filter),
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

const getStockAdjustment = async ({ tenant, adjustmentNumber }) => {
  const { models, tenantId } = resolveContext(tenant);

  const normalizedNumber = normalizeCode(adjustmentNumber);

  if (!normalizedNumber) {
    throw createError("A valid adjustment number is required");
  }

  const adjustment = await models.StockAdjustment.findOne({
    tenantId,
    adjustmentNumber: normalizedNumber,
  }).lean();

  if (!adjustment) {
    throw createError("Stock adjustment not found", 404);
  }

  return adjustment;
};

module.exports = {
  createStockAdjustment,
  listStockAdjustments,
  getStockAdjustment,
};
