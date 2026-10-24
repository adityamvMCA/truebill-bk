const mongoose = require("mongoose");
const { getReadyTenantConnection } = require("../../../tenancy/tenantConnectionManager");
const { getTenantAccountingModels } = require("../../../tenancy/tenantAccountingModels");
const { getNextSequence } = require("../../../utils/sequenceGenerator");
const { createError, text, quantityMilli, balanceMilli, ratePaise, valuePaise, requestHash, publicTransfer } = require("./stockTransfer.utils");
const preparationCache = new WeakMap();
const requiredModels = ["StockTransfer", "Product", "Warehouse", "WarehouseStock", "InventorySettings", "StockMovement", "AuditLog"];
const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw createError(`${label} must be a valid ObjectId`);
  return new mongoose.Types.ObjectId(String(value));
};
const resolve = (args) => {
  if (!args.tenant?._id) throw createError("Resolved tenant context is required", 500);
  const connection = getReadyTenantConnection(args.tenant);
  const models = getTenantAccountingModels(connection);
  for (const name of requiredModels) if (!models[name] || models[name].db !== connection) throw createError(`Invalid tenant model: ${name}`, 500);
  return { ...args, connection, models, tenantId: objectId(args.tenant._id, "tenantId") };
};
const prepare = async (context) => {
  let pending = preparationCache.get(context.connection);
  if (!pending) {
    pending = (async () => {
      for (const field of ["warehouseId", "aggregateStockBefore", "aggregateStockAfter"]) {
        if (!context.models.StockMovement.schema.path(field)) throw createError(`StockMovement model is missing ${field}; apply the model integration changes first`, 500);
      }
      for (const value of ["TRANSFER_IN", "TRANSFER_OUT"]) {
        if (!context.models.StockMovement.schema.path("movementType")?.enumValues?.includes(value)) throw createError(`StockMovement must allow ${value}`, 500);
      }
      if (!context.models.StockMovement.schema.path("referenceType")?.enumValues?.includes("STOCK_TRANSFER")) throw createError("StockMovement must allow STOCK_TRANSFER references", 500);
      for (const name of requiredModels) {
        try { await context.models[name].createCollection(); }
        catch (error) { if (error.code !== 48 && error.codeName !== "NamespaceExists") throw error; }
        await context.models[name].createIndexes();
      }
      try { await context.connection.db.createCollection("counters"); }
      catch (error) { if (error.code !== 48 && error.codeName !== "NamespaceExists") throw error; }
    })();
    preparationCache.set(context.connection, pending);
  }
  try { await pending; }
  catch (error) { if (preparationCache.get(context.connection) === pending) preparationCache.delete(context.connection); throw error; }
};
const lockSettings = async (context) => {
  const settings = await context.models.InventorySettings.findOneAndUpdate({ tenantId: context.tenantId }, { $inc: { __v: 1 } }, {
    new: true, session: context.session, timestamps: false,
  });
  if (!settings) throw createError("Warehouse setup is missing", 409);
  if (settings.warehouseTrackingStatus !== "READY" || !settings.warehouseTrackingStartedAt) throw createError("Initialize warehouse stock before using transfers", 409);
  return settings;
};
const runTransaction = async (context, operation) => {
  const session = await context.connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation({ ...context, session }); });
    return result;
  } finally { await session.endSession(); }
};
const normalizedPayload = (payload = {}) => {
  if (typeof payload !== "object" || Array.isArray(payload)) throw createError("Transfer payload is required");
  if (Object.keys(payload).some((key) => !["requestId", "transferDate", "fromWarehouseId", "toWarehouseId", "items", "notes"].includes(key))) throw createError("Unsupported transfer fields");
  const requestId = text(payload.requestId).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw createError("requestId must be a UUID v4");
  const transferDate = new Date(payload.transferDate);
  if (!payload.transferDate || Number.isNaN(transferDate.getTime()) || transferDate > new Date()) throw createError("A valid, non-future transferDate is required");
  const fromWarehouseId = objectId(payload.fromWarehouseId, "fromWarehouseId");
  const toWarehouseId = objectId(payload.toWarehouseId, "toWarehouseId");
  if (String(fromWarehouseId) === String(toWarehouseId)) throw createError("Source and destination warehouses must be different");
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) throw createError("Provide between 1 and 100 transfer items");
  const seen = new Set();
  const items = payload.items.map((item) => {
    if (!item || Object.keys(item).some((key) => !["productId", "quantity"].includes(key))) throw createError("Invalid transfer item fields");
    const productId = objectId(item.productId, "productId");
    if (seen.has(String(productId))) throw createError("A Product can appear only once in a transfer");
    seen.add(String(productId));
    return { productId, quantity: quantityMilli(item.quantity) / 1000 };
  });
  const notes = text(payload.notes) || null;
  if (notes && notes.length > 500) throw createError("Notes cannot exceed 500 characters");
  return { requestId, transferDate, fromWarehouseId, toWarehouseId, items, notes };
};
const existingRequest = async (context, payload, hash) => {
  const record = await context.models.StockTransfer.findOne({ tenantId: context.tenantId, requestId: payload.requestId }).select("+requestHash").session(context.session ?? null);
  if (!record) return null;
  if (record.requestHash !== hash) throw createError("This requestId was already used for a different transfer", 409, "IDEMPOTENCY_CONFLICT");
  return { ...publicTransfer(record), replayed: true };
};
const createTransfer = async (args) => {
  const payload = normalizedPayload(args.payload);
  const context = resolve(args);
  context.userId = objectId(args.userId, "userId");
  const hash = requestHash(payload);
  await prepare(context);
  try {
    return await runTransaction(context, async (tx) => {
      const existing = await existingRequest(tx, payload, hash);
      if (existing) return existing;
      const settings = await lockSettings(tx);
      if (settings.multiWarehouseEnabled !== true) throw createError("Enable multi-warehouse mode before transferring stock", 409);
      const warehouseMap = new Map();
      for (const warehouseId of [payload.fromWarehouseId, payload.toWarehouseId].sort((a, b) => String(a).localeCompare(String(b)))) {
        const warehouse = await tx.models.Warehouse.findOneAndUpdate({ _id: warehouseId, tenantId: tx.tenantId, status: "ACTIVE" }, { $inc: { __v: 1 } }, {
          new: true, session: tx.session, timestamps: false,
        }).lean();
        if (!warehouse) throw createError("Source or destination warehouse is missing or inactive", 409);
        warehouseMap.set(String(warehouseId), warehouse);
      }
      const sourceWarehouse = warehouseMap.get(String(payload.fromWarehouseId));
      const destinationWarehouse = warehouseMap.get(String(payload.toWarehouseId));
      const products = await tx.models.Product.find({
        tenantId: tx.tenantId, _id: { $in: payload.items.map((item) => item.productId) },
        isDeleted: false, status: "ACTIVE", type: "GOODS", trackInventory: true,
      }).session(tx.session).lean();
      if (products.length !== payload.items.length) throw createError("One or more Products are missing, inactive or not inventory-tracked Goods", 409);
      const productMap = new Map(products.map((product) => [String(product._id), product]));
      let transferNumber;
      do {
        transferNumber = await getNextSequence("TRF", String(tx.tenantId), 3, { connection: tx.connection, session: tx.session });
        if (typeof transferNumber !== "string" || !/^TRF\d+$/.test(transferNumber)) throw createError("Invalid transfer sequence result", 500);
      } while (await tx.models.StockTransfer.exists({ tenantId: tx.tenantId, transferNumber }).session(tx.session));
      const transferId = new mongoose.Types.ObjectId();
      const lines = [];
      let totalValue = 0n;
      for (const input of [...payload.items].sort((a, b) => String(a.productId).localeCompare(String(b.productId)))) {
        const product = productMap.get(String(input.productId));
        const quantity = quantityMilli(input.quantity);
        const aggregate = balanceMilli(product.currentStock);
        const price = ratePaise(product.purchasePrice);
        const amount = valuePaise(quantity, price);
        totalValue += BigInt(amount);
        if (totalValue > BigInt(Number.MAX_SAFE_INTEGER)) throw createError("Transfer reference value exceeds the supported range");
        const balances = await tx.models.WarehouseStock.find({ tenantId: tx.tenantId, productId: product._id }).session(tx.session);
        let balanceTotal = 0n;
        for (const balance of balances) balanceTotal += BigInt(balanceMilli(balance.currentStock));
        if (balanceTotal !== BigInt(aggregate)) throw createError(`Warehouse balances do not match Product stock for ${product.productCode}. Reconcile before transferring.`, 409);
        const source = balances.find((record) => String(record.warehouseId) === String(payload.fromWarehouseId));
        let destination = balances.find((record) => String(record.warehouseId) === String(payload.toWarehouseId));
        const sourceBefore = source ? balanceMilli(source.currentStock) : 0;
        const destinationBefore = destination ? balanceMilli(destination.currentStock) : 0;
        if (!source || sourceBefore < quantity) throw createError(`Insufficient source stock for ${product.productCode}. Available: ${sourceBefore / 1000} ${product.unit}.`, 409);
        const sourceAfter = sourceBefore - quantity;
        const destinationAfter = destinationBefore + quantity;
        if (!Number.isSafeInteger(destinationAfter)) throw createError("Destination balance exceeds the supported range", 409);
        const lockedProduct = await tx.models.Product.updateOne({
          _id: product._id, tenantId: tx.tenantId, __v: product.__v, isDeleted: false,
          status: "ACTIVE", type: "GOODS", trackInventory: true,
        }, { $inc: { __v: 1 } }, { session: tx.session, timestamps: false });
        if (lockedProduct.modifiedCount !== 1) throw createError("Product changed. Reload before continuing.", 409);
        source.currentStock = sourceAfter / 1000;
        await source.save({ session: tx.session });
        if (destination) {
          destination.currentStock = destinationAfter / 1000;
          await destination.save({ session: tx.session });
        } else {
          [destination] = await tx.models.WarehouseStock.create([{
            tenantId: tx.tenantId, warehouseId: payload.toWarehouseId, productId: product._id, currentStock: destinationAfter / 1000,
          }], { session: tx.session });
        }
        const outMovementId = new mongoose.Types.ObjectId();
        const inMovementId = new mongoose.Types.ObjectId();
        const common = {
          tenantId: tx.tenantId, productId: product._id, productCode: product.productCode,
          quantity: quantity / 1000, unitRate: price / 100, totalValue: amount / 100,
          aggregateStockBefore: aggregate / 1000, aggregateStockAfter: aggregate / 1000,
          referenceType: "STOCK_TRANSFER", referenceId: transferId, referenceNumber: transferNumber,
          movementDate: payload.transferDate, notes: payload.notes, createdBy: tx.userId,
        };
        await tx.models.StockMovement.create([
          { ...common, _id: outMovementId, warehouseId: payload.fromWarehouseId, movementType: "TRANSFER_OUT", direction: "OUT", stockBefore: sourceBefore / 1000, stockAfter: sourceAfter / 1000 },
          { ...common, _id: inMovementId, warehouseId: payload.toWarehouseId, movementType: "TRANSFER_IN", direction: "IN", stockBefore: destinationBefore / 1000, stockAfter: destinationAfter / 1000 },
        ], { session: tx.session, ordered: true });
        lines.push({
          productId: product._id, productCode: product.productCode, productName: product.name, unit: product.unit,
          quantity: quantity / 1000, unitRatePaise: price, totalValuePaise: amount,
          sourceStockBefore: sourceBefore / 1000, sourceStockAfter: sourceAfter / 1000,
          destinationStockBefore: destinationBefore / 1000, destinationStockAfter: destinationAfter / 1000,
          aggregateStock: aggregate / 1000, outMovementId, inMovementId,
        });
      }
      const [transfer] = await tx.models.StockTransfer.create([{
        _id: transferId, tenantId: tx.tenantId, transferNumber, requestId: payload.requestId, requestHash: hash,
        transferDate: payload.transferDate,
        fromWarehouseId: sourceWarehouse._id, fromWarehouseCode: sourceWarehouse.warehouseCode, fromWarehouseName: sourceWarehouse.name,
        toWarehouseId: destinationWarehouse._id, toWarehouseCode: destinationWarehouse.warehouseCode, toWarehouseName: destinationWarehouse.name,
        items: lines, itemCount: lines.length, totalValuePaise: Number(totalValue), notes: payload.notes,
        status: "POSTED", postedAt: new Date(), postedBy: tx.userId, createdBy: tx.userId,
      }], { session: tx.session });
      await tx.models.AuditLog.create([{
        tenantId: tx.tenantId, userId: tx.userId, action: "CREATE", module: "STOCK_TRANSFER",
        documentId: transfer._id, oldData: null, newData: publicTransfer(transfer), ipAddress: tx.ipAddress,
      }], { session: tx.session });
      return { ...publicTransfer(transfer), replayed: false };
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await existingRequest(context, payload, hash);
      if (existing) return existing;
      throw createError("A transfer number, stock balance or movement reference already exists", 409);
    }
    if (error.name === "VersionError") throw createError("Stock changed. Reload before continuing.", 409);
    throw error;
  }
};
const getTransfer = async (args) => {
  const context = resolve(args);
  const transferNumber = text(args.transferNumber).toUpperCase();
  if (!transferNumber) throw createError("A transfer number is required");
  const document = await context.models.StockTransfer.findOne({ tenantId: context.tenantId, transferNumber }).lean();
  if (!document) throw createError("Stock transfer not found", 404);
  return publicTransfer(document);
};
const listTransfers = async (args) => {
  const context = resolve(args);
  const page = Number(args.page ?? 1), limit = Number(args.limit ?? 20);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(skip)) throw createError("Invalid pagination");
  const filter = { tenantId: context.tenantId };
  for (const key of ["fromWarehouseId", "toWarehouseId"]) if (args[key]) filter[key] = objectId(args[key], key);
  const search = text(args.search);
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = ["transferNumber", "fromWarehouseCode", "fromWarehouseName", "toWarehouseCode", "toWarehouseName", "notes"].map((key) => ({ [key]: regex }));
  }
  const [data, total] = await Promise.all([
    context.models.StockTransfer.find(filter).select("-items -requestHash").sort({ transferDate: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    context.models.StockTransfer.countDocuments(filter),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};
const enableMultiWarehouse = async (args) => {
  if (args.confirm !== true) throw createError("Explicit confirmation is required");
  const context = resolve(args);
  context.userId = objectId(args.userId, "userId");
  await prepare(context);
  return runTransaction(context, async (tx) => {
    const settings = await lockSettings(tx);
    if (settings.multiWarehouseEnabled) return { alreadyEnabled: true, settings: settings.toObject() };
    const oldData = settings.toObject();
    const warehouses = await tx.models.Warehouse.find({ tenantId: tx.tenantId }).session(tx.session).lean();
    const warehouseMap = new Map(warehouses.map((record) => [String(record._id), record]));
    const active = warehouses.filter((record) => record.status === "ACTIVE");
    if (active.length < 2) throw createError("Create at least two active warehouses before enabling multi-warehouse mode", 409);
    if (warehouseMap.get(String(settings.defaultWarehouseId))?.status !== "ACTIVE") throw createError("The default warehouse is missing or inactive", 409);
    const products = await tx.models.Product.find({ tenantId: tx.tenantId }).select("_id productCode currentStock type trackInventory isDeleted").limit(5001).session(tx.session).lean();
    const balances = await tx.models.WarehouseStock.find({ tenantId: tx.tenantId }).limit(10001).session(tx.session).lean();
    if (products.length > 5000 || balances.length > 10000) throw createError("Inventory exceeds this activation check's maintenance limit. Use a dedicated reconciliation migration.", 409);
    const productMap = new Map(products.map((record) => [String(record._id), record]));
    const sums = new Map();
    for (const balance of balances) {
      const product = productMap.get(String(balance.productId));
      const warehouse = warehouseMap.get(String(balance.warehouseId));
      const quantity = balanceMilli(balance.currentStock);
      if (!product || !warehouse) throw createError("A warehouse balance references a missing Product or warehouse", 409);
      if (quantity > 0 && (warehouse.status !== "ACTIVE" || product.isDeleted || product.type !== "GOODS" || product.trackInventory !== true)) throw createError("Reconcile stock attached to an inactive warehouse or ineligible Product before enabling", 409);
      const key = String(balance.productId);
      sums.set(key, (sums.get(key) || 0n) + BigInt(quantity));
    }
    for (const product of products) {
      const aggregate = balanceMilli(product.currentStock ?? 0);
      const eligible = product.type === "GOODS" && product.trackInventory === true && product.isDeleted !== true;
      if (!eligible && aggregate > 0) throw createError(`Reconcile ineligible Product ${product.productCode} before enabling`, 409);
      if (eligible && (sums.get(String(product._id)) || 0n) !== BigInt(aggregate)) throw createError(`Warehouse stock does not match Product stock for ${product.productCode}`, 409);
    }
    settings.multiWarehouseEnabled = true;
    settings.updatedBy = tx.userId;
    await settings.save({ session: tx.session });
    await tx.models.AuditLog.create([{
      tenantId: tx.tenantId, userId: tx.userId, action: "UPDATE", module: "INVENTORY_SETTINGS", documentId: settings._id,
      oldData, newData: settings.toObject(), ipAddress: tx.ipAddress,
    }], { session: tx.session });
    return { alreadyEnabled: false, settings: settings.toObject(), activeWarehouseCount: active.length };
  });
};
module.exports = { createTransfer, getTransfer, listTransfers, enableMultiWarehouse };
