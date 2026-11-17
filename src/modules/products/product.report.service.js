const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");
const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

/* ------------------------------------------------------------------ */
/* CONFIG – matched to SalesOrder / PurchaseOrder documents            */
/* ------------------------------------------------------------------ */

const CONFIG = {
  sales: {
    modelName: "SalesOrder",
    dateField: "orderDate",
    partyIdField: "customerId",
    partyNameField: "customerName", // stored on the order
    partyModelName: "Customer", // fallback lookup if name is missing
    partyNameCandidates: ["name", "customerName", "companyName"],
    itemsField: "items",
    itemProductField: "productId",
    quantityField: "quantity",
    rateField: "unitRatePaise",
    amountField: "totalAmountPaise", // use "taxableAmountPaise" to exclude GST
    excludedStatuses: ["CANCELLED", "DRAFT"],
  },
  purchase: {
    modelName: "PurchaseOrder",
    dateField: "orderDate",
    partyIdField: "supplierId",
    partyNameField: null, // not stored on the order -> looked up
    partyModelName: "Supplier",
    partyNameCandidates: ["name", "supplierName", "companyName"],
    itemsField: "items",
    itemProductField: "productId",
    quantityField: "quantity",
    rateField: "unitRatePaise",
    amountField: "totalAmountPaise",
    excludedStatuses: ["CANCELLED", "DRAFT"],
  },
  amountDivisor: 100, // paise -> rupees
  warehouseModelName: "Warehouse",
  warehouseNameField: "name",
  warehouseAddressField: "address",
};

// Stock movement types that increase / decrease stock.
// Anything not listed falls back to the sign already stored in `quantity`.
const IN_TYPES = new Set([
  "OPENING",
  "PURCHASE",
  "PURCHASE_BILL",
  "SALES_RETURN",
  "CREDIT_NOTE",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "PRODUCTION_IN",
]);

const OUT_TYPES = new Set([
  "SALE",
  "SALES_INVOICE",
  "PURCHASE_RETURN",
  "DEBIT_NOTE",
  "TRANSFER_OUT",
  "ADJUSTMENT_OUT",
  "PRODUCTION_OUT",
]);

const MOVEMENT_LABELS = {
  OPENING: "Opening Stock",
  PURCHASE: "Purchase Bills",
  PURCHASE_BILL: "Purchase Bills",
  SALE: "Sales Invoices",
  SALES_INVOICE: "Sales Invoices",
  SALES_RETURN: "Sales Return",
  PURCHASE_RETURN: "Purchase Return",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out",
  ADJUSTMENT_IN: "Stock Adjustment",
  ADJUSTMENT_OUT: "Stock Adjustment",
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const resolveContext = (tenant) => {
  if (!tenant?._id) throw createError("Resolved tenant context is required", 500);

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  return { models, tenantId: tenant._id };
};

const parseRange = (startDate, endDate) => {
  const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : new Date();
  const start = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw createError("Invalid date range");
  }

  if (start > end) throw createError("From date cannot be after To date");

  return { start, end };
};

const findProduct = async ({ models, tenantId, productCode }) => {
  const code = String(productCode ?? "").trim().toUpperCase();

  const product = await models.Product.findOne({
    tenantId,
    productCode: code,
    isDeleted: false,
  }).lean();

  if (!product) throw createError("Product not found", 404);

  return product;
};

const getModel = (models, name) => {
  const model = models[name];

  if (!model) {
    throw createError(
      `Model "${name}" is not registered in getTenantAccountingModels. Update CONFIG in product.report.service.js`,
      500,
    );
  }

  return model;
};

const signedQuantity = (movement) => {
  const quantity = Number(movement.quantity) || 0;

  if (IN_TYPES.has(movement.movementType)) return Math.abs(quantity);
  if (OUT_TYPES.has(movement.movementType)) return -Math.abs(quantity);

  return quantity;
};

const round3 = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toRupees = (paise) => round2((Number(paise) || 0) / CONFIG.amountDivisor);

// Fill in missing party names (e.g. suppliers) from the party collection.
const attachPartyNames = async ({ models, tenantId, cfg, rows }) => {
  const missing = rows
    .filter((row) => row._id.id && !row._id.name)
    .map((row) => row._id.id);

  if (!missing.length) return rows;

  const PartyModel = models[cfg.partyModelName];
  if (!PartyModel) return rows;

  const parties = await PartyModel.find({
    tenantId,
    _id: { $in: missing },
  }).lean();

  const names = new Map(
    parties.map((party) => [
      String(party._id),
      cfg.partyNameCandidates.map((key) => party[key]).find(Boolean) || null,
    ]),
  );

  return rows.map((row) => ({
    ...row,
    _id: {
      ...row._id,
      name: row._id.name || names.get(String(row._id.id)) || null,
    },
  }));
};

/* ------------------------------------------------------------------ */
/* 1. Stock details                                                    */
/* ------------------------------------------------------------------ */

const getStockDetails = async ({ tenant, productCode, startDate, endDate }) => {
  const { models, tenantId } = resolveContext(tenant);
  const product = await findProduct({ models, tenantId, productCode });
  const { start, end } = parseRange(startDate, endDate);

  const { StockMovement } = models;

  // Stock held before the selected range (so closing stock stays correct).
  const before = await StockMovement.aggregate([
    {
      $match: {
        tenantId,
        productId: product._id,
        movementDate: { $lt: start },
      },
    },
    {
      $group: {
        _id: "$movementType",
        quantity: { $sum: "$quantity" },
      },
    },
  ]);

  let running = before.reduce(
    (sum, row) =>
      sum +
      signedQuantity({ movementType: row._id, quantity: row.quantity }),
    0,
  );

  const movements = await StockMovement.find({
    tenantId,
    productId: product._id,
    movementDate: { $gte: start, $lte: end },
  })
    .sort({ movementDate: 1, _id: 1 })
    .lean();

  const rows = movements.map((movement) => {
    const change = signedQuantity(movement);
    running = round3(running + change);

    return {
      _id: movement._id,
      date: movement.movementDate,
      transactionType:
        MOVEMENT_LABELS[movement.movementType] || movement.movementType,
      movementType: movement.movementType,
      quantity: round3(change),
      invoiceNumber: movement.referenceNumber || null,
      referenceType: movement.referenceType || null,
      referenceId: movement.referenceId || null,
      closingStock: running,
    };
  });

  return {
    product: {
      productCode: product.productCode,
      name: product.name,
      unit: product.unit,
    },
    // newest first
    rows: rows.reverse(),
  };
};

/* ------------------------------------------------------------------ */
/* 2. Party wise report                                                */
/* ------------------------------------------------------------------ */

const aggregateParties = (Model, cfg, { tenantId, productId, start, end }) => {
  const items = cfg.itemsField;
  const productPath = `${items}.${cfg.itemProductField}`;

  return Model.aggregate([
    {
      $match: {
        tenantId,
        isDeleted: { $ne: true },
        status: { $nin: cfg.excludedStatuses },
        [cfg.dateField]: { $gte: start, $lte: end },
        [productPath]: productId,
      },
    },
    { $unwind: `$${items}` },
    { $match: { [productPath]: productId } },
    {
      $group: {
        _id: {
          id: `$${cfg.partyIdField}`,
          name: cfg.partyNameField ? `$${cfg.partyNameField}` : null,
        },
        quantity: { $sum: `$${items}.${cfg.quantityField}` },
        // the amount fields (e.g. totalAmountPaise) live on each line item
        amount: { $sum: `$${items}.${cfg.amountField}` },
      },
    },
  ]);
};

const getPartyWiseReport = async ({
  tenant,
  productCode,
  startDate,
  endDate,
}) => {
  const { models, tenantId } = resolveContext(tenant);
  const product = await findProduct({ models, tenantId, productCode });
  const { start, end } = parseRange(startDate, endDate);

  const args = { tenantId, productId: product._id, start, end };

  const [salesRaw, purchasesRaw] = await Promise.all([
    aggregateParties(
      getModel(models, CONFIG.sales.modelName),
      CONFIG.sales,
      args,
    ),
    aggregateParties(
      getModel(models, CONFIG.purchase.modelName),
      CONFIG.purchase,
      args,
    ),
  ]);

  const [sales, purchases] = await Promise.all([
    attachPartyNames({ models, tenantId, cfg: CONFIG.sales, rows: salesRaw }),
    attachPartyNames({
      models,
      tenantId,
      cfg: CONFIG.purchase,
      rows: purchasesRaw,
    }),
  ]);

  const parties = new Map();

  const upsert = (row, kind) => {
    const key = String(row._id.id || row._id.name || "unknown");

    if (!parties.has(key)) {
      parties.set(key, {
        partyId: row._id.id || null,
        partyName: row._id.name || "Unknown Party",
        salesQuantity: 0,
        salesAmount: 0,
        purchaseQuantity: 0,
        purchaseAmount: 0,
      });
    }

    const party = parties.get(key);

    party[`${kind}Quantity`] += Number(row.quantity) || 0;
    party[`${kind}Amount`] += Number(row.amount) || 0; // still paise here
  };

  sales.forEach((row) => upsert(row, "sales"));
  purchases.forEach((row) => upsert(row, "purchase"));

  const rows = [...parties.values()]
    .map((party) => ({
      ...party,
      salesQuantity: round3(party.salesQuantity),
      salesAmount: toRupees(party.salesAmount),
      purchaseQuantity: round3(party.purchaseQuantity),
      purchaseAmount: toRupees(party.purchaseAmount),
    }))
    .sort((a, b) => a.partyName.localeCompare(b.partyName));

  return {
    product: { productCode: product.productCode, name: product.name },
    rows,
  };
};

/* ------------------------------------------------------------------ */
/* 3. Godown (warehouse) wise stock                                    */
/* ------------------------------------------------------------------ */

const getGodownReport = async ({ tenant, productCode }) => {
  const { models, tenantId } = resolveContext(tenant);
  const product = await findProduct({ models, tenantId, productCode });

  const { WarehouseStock } = models;

  if (!WarehouseStock) {
    throw createError("WarehouseStock model is not registered", 500);
  }

  const stocks = await WarehouseStock.find({
    tenantId,
    productId: product._id,
  }).lean();

  const ids = stocks.map((stock) => stock.warehouseId).filter(Boolean);

  const Warehouse = models[CONFIG.warehouseModelName];

  const warehouses =
    Warehouse && ids.length
      ? await Warehouse.find({ tenantId, _id: { $in: ids } }).lean()
      : [];

  const byId = new Map(warehouses.map((w) => [String(w._id), w]));

  return {
    product: {
      productCode: product.productCode,
      name: product.name,
      unit: product.unit,
    },
    rows: stocks.map((stock) => {
      const warehouse = byId.get(String(stock.warehouseId));

      return {
        _id: stock._id,
        warehouseId: stock.warehouseId,
        godownName: warehouse?.[CONFIG.warehouseNameField] || "Main Godown",
        address: warehouse?.[CONFIG.warehouseAddressField] || "",
        stockAvailable: round3(stock.currentStock),
      };
    }),
  };
};

/* ------------------------------------------------------------------ */
/* 4. Party wise prices (last rate used with every party)              */
/* ------------------------------------------------------------------ */

const aggregateLastRates = (Model, cfg, { tenantId, productId }) => {
  const items = cfg.itemsField;
  const productPath = `${items}.${cfg.itemProductField}`;

  return Model.aggregate([
    {
      $match: {
        tenantId,
        isDeleted: { $ne: true },
        status: { $nin: cfg.excludedStatuses },
        [productPath]: productId,
      },
    },
    { $unwind: `$${items}` },
    { $match: { [productPath]: productId } },
    { $sort: { [cfg.dateField]: 1, _id: 1 } },
    {
      $group: {
        _id: {
          id: `$${cfg.partyIdField}`,
          name: cfg.partyNameField ? `$${cfg.partyNameField}` : null,
        },
        lastRate: { $last: `$${items}.${cfg.rateField}` },
        lastDate: { $last: `$${cfg.dateField}` },
        minRate: { $min: `$${items}.${cfg.rateField}` },
        maxRate: { $max: `$${items}.${cfg.rateField}` },
      },
    },
  ]);
};

const getPartyPrices = async ({ tenant, productCode }) => {
  const { models, tenantId } = resolveContext(tenant);
  const product = await findProduct({ models, tenantId, productCode });

  const args = { tenantId, productId: product._id };

  const [salesRaw, purchasesRaw] = await Promise.all([
    aggregateLastRates(
      getModel(models, CONFIG.sales.modelName),
      CONFIG.sales,
      args,
    ),
    aggregateLastRates(
      getModel(models, CONFIG.purchase.modelName),
      CONFIG.purchase,
      args,
    ),
  ]);

  const [sales, purchases] = await Promise.all([
    attachPartyNames({ models, tenantId, cfg: CONFIG.sales, rows: salesRaw }),
    attachPartyNames({
      models,
      tenantId,
      cfg: CONFIG.purchase,
      rows: purchasesRaw,
    }),
  ]);

  const map = (rows, type) =>
    rows.map((row) => ({
      partyId: row._id.id || null,
      partyName: row._id.name || "Unknown Party",
      partyType: type,
      lastRate: toRupees(row.lastRate),
      minRate: toRupees(row.minRate),
      maxRate: toRupees(row.maxRate),
      lastDate: row.lastDate,
    }));

  return {
    product: {
      productCode: product.productCode,
      name: product.name,
      salePrice: product.salePrice,
      purchasePrice: product.purchasePrice,
    },
    rows: [...map(sales, "CUSTOMER"), ...map(purchases, "SUPPLIER")].sort(
      (a, b) => a.partyName.localeCompare(b.partyName),
    ),
  };
};

module.exports = {
  getStockDetails,
  getPartyWiseReport,
  getGodownReport,
  getPartyPrices,
};