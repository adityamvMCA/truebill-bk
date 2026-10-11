const mongoose = require("mongoose");

const Product = require("../products/product.model");
const StockMovement = require("./stockMovement.model");
const AuditLog = require("../../models/AuditLog");

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

  TRANSFER_IN: {
    direction: "IN",
    referenceType: "STOCK_TRANSFER",
  },

  TRANSFER_OUT: {
    direction: "OUT",
    referenceType: "STOCK_TRANSFER",
  },
};

const normalizeText = (value) => String(value || "").trim();

const roundQuantity = (value) =>
  Math.round((Number(value) || 0) * 1000) / 1000;

const roundAmount = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

const createStockMovement = async ({
  tenantId,
  userId,
  productId,
  movementType,
  quantity,
  unitRate = 0,
  referenceType = null,
  referenceId = null,
  referenceNumber = null,
  movementDate = new Date(),
  notes = null,
  session = null,
}) => {
  const rule = MOVEMENT_RULES[movementType];

  if (!rule) {
    const error = new Error("Invalid stock movement type");
    error.statusCode = 400;
    throw error;
  }

  const normalizedQuantity = roundQuantity(quantity);
  const normalizedRate = roundAmount(unitRate);

  if (normalizedQuantity <= 0) {
    const error = new Error("Stock quantity must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  const productQuery = Product.findOne({
    _id: productId,
    tenantId,
    isDeleted: false,
  });

  if (session) {
    productQuery.session(session);
  }

  const product = await productQuery;

  if (!product) {
    const error = new Error("Product not found");
    error.statusCode = 404;
    throw error;
  }

  if (product.type !== "GOODS" || !product.trackInventory) {
    const error = new Error(
      "Stock movement is allowed only for inventory-tracked Goods products"
    );
    error.statusCode = 400;
    throw error;
  }

  const direction = rule.direction;
  const stockBefore = roundQuantity(product.currentStock);

  const stockAfter =
    direction === "IN"
      ? roundQuantity(stockBefore + normalizedQuantity)
      : roundQuantity(stockBefore - normalizedQuantity);

  if (stockAfter < 0) {
    const error = new Error(
      `Insufficient stock. Available stock is ${stockBefore}.`
    );
    error.statusCode = 409;
    throw error;
  }

  const resolvedReferenceType =
    referenceType || rule.referenceType;

  const totalValue = roundAmount(
    normalizedQuantity * normalizedRate
  );

  const movementPayload = {
    tenantId,
    productId: product._id,
    productCode: product.productCode,
    movementType,
    direction,
    quantity: normalizedQuantity,
    unitRate: normalizedRate,
    totalValue,
    stockBefore,
    stockAfter,
    referenceType: resolvedReferenceType,
    referenceId,
    referenceNumber:
      normalizeText(referenceNumber).toUpperCase() || null,
    movementDate,
    notes: normalizeText(notes) || null,
    createdBy: userId,
  };

  let movement;

  if (session) {
    const records = await StockMovement.create(
      [movementPayload],
      { session }
    );

    movement = records[0];

    product.currentStock = stockAfter;
    await product.save({ session });
  } else {
    movement = await StockMovement.create(movementPayload);

    product.currentStock = stockAfter;
    await product.save();
  }

  return {
    product,
    movement,
  };
};

const getStockMovements = async ({
  tenantId,
  productCode,
  movementType,
  direction,
  page = 1,
  limit = 50,
}) => {
  const currentPage = Math.max(Number(page) || 1, 1);

  const pageLimit = Math.min(
    Math.max(Number(limit) || 50, 1),
    100
  );

  const filter = {
    tenantId,
  };

  if (productCode) {
    filter.productCode = String(productCode)
      .trim()
      .toUpperCase();
  }

  if (movementType) {
    filter.movementType = String(movementType)
      .trim()
      .toUpperCase();
  }

  if (direction) {
    filter.direction = String(direction)
      .trim()
      .toUpperCase();
  }

  const [data, total] = await Promise.all([
    StockMovement.find(filter)
      .sort({
        movementDate: -1,
        createdAt: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .populate("productId", "productCode name unit")
      .lean(),

    StockMovement.countDocuments(filter),
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

const createManualAdjustment = async ({
  tenantId,
  userId,
  productCode,
  adjustmentType,
  quantity,
  unitRate,
  notes,
  ipAddress,
}) => {
  const normalizedProductCode = String(productCode)
    .trim()
    .toUpperCase();

  const normalizedAdjustmentType = String(adjustmentType)
    .trim()
    .toUpperCase();

  if (
    !["ADJUSTMENT_IN", "ADJUSTMENT_OUT"].includes(
      normalizedAdjustmentType
    )
  ) {
    const error = new Error(
      "adjustmentType must be ADJUSTMENT_IN or ADJUSTMENT_OUT"
    );
    error.statusCode = 400;
    throw error;
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const product = await Product.findOne({
        tenantId,
        productCode: normalizedProductCode,
        isDeleted: false,
      }).session(session);

      if (!product) {
        const error = new Error("Product not found");
        error.statusCode = 404;
        throw error;
      }

      const oldData = product.toObject();

      const movementResult = await createStockMovement({
        tenantId,
        userId,
        productId: product._id,
        movementType: normalizedAdjustmentType,
        quantity,
        unitRate,
        referenceNumber: `ADJ-${product.productCode}-${Date.now()}`,
        notes,
        session,
      });

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "STOCK_ADJUSTMENT",
            module: "PRODUCT",
            documentId: product._id,
            oldData,
            newData: movementResult.product.toObject(),
            ipAddress,
          },
        ],
        { session }
      );

      result = movementResult;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const backfillOpeningStock = async ({
  tenantId,
  userId,
  productCode,
  ipAddress,
}) => {
  const normalizedProductCode = String(productCode)
    .trim()
    .toUpperCase();

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const product = await Product.findOne({
        tenantId,
        productCode: normalizedProductCode,
        isDeleted: false,
      }).session(session);

      if (!product) {
        const error = new Error("Product not found");
        error.statusCode = 404;
        throw error;
      }

      if (product.type !== "GOODS" || !product.trackInventory) {
        const error = new Error(
          "Opening stock backfill is allowed only for inventory-tracked Goods products"
        );
        error.statusCode = 400;
        throw error;
      }

      const openingStock = roundQuantity(product.openingStock);

      if (openingStock <= 0) {
        const error = new Error(
          "Product opening stock must be greater than zero"
        );
        error.statusCode = 400;
        throw error;
      }

      const existingOpening = await StockMovement.findOne({
        tenantId,
        productId: product._id,
        movementType: "OPENING",
        referenceType: "OPENING",
      }).session(session);

      if (existingOpening) {
        const error = new Error(
          "Opening stock movement already exists for this product"
        );
        error.statusCode = 409;
        throw error;
      }

      /*
        Product.currentStock already equals openingStock because it was
        created before StockMovement existed. Temporarily reset it to zero
        inside the transaction, then create the opening IN movement.
      */
      const oldData = product.toObject();

      product.currentStock = 0;
      await product.save({ session });

      const movementResult = await createStockMovement({
        tenantId,
        userId,
        productId: product._id,
        movementType: "OPENING",
        quantity: openingStock,
        unitRate: product.openingStockRate,
        referenceNumber: `OPEN-${product.productCode}`,
        notes: "Opening stock backfill",
        session,
      });

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "OPENING_STOCK_BACKFILL",
            module: "PRODUCT",
            documentId: product._id,
            oldData,
            newData: movementResult.product.toObject(),
            ipAddress,
          },
        ],
        { session }
      );

      result = movementResult;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createStockMovement,
  getStockMovements,
  createManualAdjustment,
  backfillOpeningStock,
};