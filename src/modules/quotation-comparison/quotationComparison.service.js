const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

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

const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of ["SupplierQuotation", "PurchaseRfq"]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  return {
    models,
    tenantId: objectId(args.tenant._id, "tenantId"),
  };
};

/* ==========================================
   STORED DATA CHECKS
   ========================================== */

const quantityMilli = (value) => {
  const scaled = value * 1000;
  const rounded = Math.round(scaled);

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isSafeInteger(rounded) ||
    Math.abs(scaled - rounded) > 0.000001
  ) {
    throw createError(
      "A comparison document contains an invalid quantity",
      409,
    );
  }

  return rounded;
};

const assertQuotationAmounts = (quotation) => {
  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  if (
    !Array.isArray(quotation.items) ||
    quotation.items.length < 1 ||
    quotation.items.length > 200
  ) {
    throw createError(`Invalid items in ${quotation.quotationNumber}`, 409);
  }

  for (const item of quotation.items) {
    quantityMilli(item.quantity);

    if (!Number.isSafeInteger(item.unitRatePaise) || item.unitRatePaise < 0) {
      throw createError(
        `Invalid unit rate in ${quotation.quotationNumber}`,
        409,
      );
    }

    for (const field of AMOUNT_FIELDS) {
      if (!Number.isSafeInteger(item[field]) || item[field] < 0) {
        throw createError(
          `Invalid ${field} in ${quotation.quotationNumber}`,
          409,
        );
      }

      totals[field] += item[field];

      if (!Number.isSafeInteger(totals[field])) {
        throw createError("Quotation totals exceed the supported range", 409);
      }
    }
  }

  for (const field of AMOUNT_FIELDS) {
    if (
      !Number.isSafeInteger(quotation[field]) ||
      quotation[field] !== totals[field]
    ) {
      throw createError(
        `Stored totals are inconsistent in ${quotation.quotationNumber}`,
        409,
      );
    }
  }
};

const assertCommonAccountingBasis = (quotations) => {
  const first = quotations[0];

  for (const quotation of quotations) {
    if (
      quotation.currency !== first.currency ||
      quotation.taxMode !== first.taxMode
    ) {
      throw createError(
        "Compare quotations with the same currency and tax mode",
        409,
      );
    }
  }
};

/* ==========================================
   EXPIRY

   Date-only validity is treated as inclusive
   through the corresponding UTC calendar day.
   ========================================== */

const isExpired = (value, now) => {
  if (!value) return false;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError("Quotation contains an invalid validity date", 409);
  }

  const endExclusive = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  );

  return now >= endExclusive;
};

/* ==========================================
   ROW / OFFER HELPERS
   ========================================== */

const makeOffer = (quotation, item) => ({
  quotationId: quotation._id,
  quotationNumber: quotation.quotationNumber,
  supplierId: quotation.supplierId,

  quotationLineId: item.lineId,
  rfqLineId: item.rfqLineId || null,

  quantity: item.quantity,
  unitRatePaise: item.unitRatePaise,
  discountPercent: item.discountPercent,
  gstRate: item.gstRate,

  ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, item[field]])),
});

const makeSummary = (quotation, complete, reasons, now) => {
  const expired = isExpired(quotation.validUntil, now);
  const warnings = [...reasons];

  if (expired) {
    warnings.push("Quotation validity has expired");
  }

  return {
    quotationId: quotation._id,
    quotationNumber: quotation.quotationNumber,

    // Send this version when implementing selection
    // or Purchase Order conversion later.
    version: quotation.__v,

    supplierId: quotation.supplierId,

    supplierReferenceNumber: quotation.supplierReferenceNumber || null,

    creationMode: quotation.creationMode,
    quotationDate: quotation.quotationDate,
    validUntil: quotation.validUntil,

    currency: quotation.currency,
    taxMode: quotation.taxMode,

    paymentTerms: quotation.paymentTerms,
    deliveryTerms: quotation.deliveryTerms,
    termsAndConditions: quotation.termsAndConditions,
    notes: quotation.notes,

    complete,
    expired,
    eligibleForRanking: complete && !expired,
    warnings,

    ...Object.fromEntries(
      AMOUNT_FIELDS.map((field) => [field, quotation[field]]),
    ),

    rank: null,
  };
};

const rankSummaries = (summaries) => {
  const eligible = summaries
    .filter((summary) => summary.eligibleForRanking)
    .sort(
      (first, second) =>
        first.totalAmountPaise - second.totalAmountPaise ||
        String(first.quotationId).localeCompare(String(second.quotationId)),
    );

  let previousAmount = null;
  let rank = 0;

  for (const [index, summary] of eligible.entries()) {
    if (summary.totalAmountPaise !== previousAmount) {
      rank = index + 1;
      previousAmount = summary.totalAmountPaise;
    }

    summary.rank = rank;
  }

  const lowestTotalAmountPaise = eligible[0]?.totalAmountPaise ?? null;

  return {
    eligibleQuotationCount: eligible.length,
    lowestTotalAmountPaise,

    lowestQuotationIds: eligible
      .filter((summary) => summary.totalAmountPaise === lowestTotalAmountPaise)
      .map((summary) => summary.quotationId),
  };
};

/* ==========================================
   RFQ COMPARISON
   ========================================== */

const compareRfq = async (context, payload) => {
  const rfq = await context.models.PurchaseRfq.findOne({
    _id: objectId(payload.sourceRfqId, "sourceRfqId"),
    tenantId: context.tenantId,
    isDeleted: false,
    status: { $in: ["ISSUED", "CLOSED"] },
  }).lean();

  if (!rfq) {
    throw createError("An ISSUED or CLOSED RFQ is required", 404);
  }

  const quotations = await context.models.SupplierQuotation.find({
    tenantId: context.tenantId,
    creationMode: "RFQ",
    sourceRfqId: rfq._id,
    isDeleted: false,
    status: "CREATED",
  })
    .sort({
      quotationDate: 1,
      _id: 1,
    })
    .limit(101)
    .lean();

  if (quotations.length < 2) {
    throw createError(
      "At least two active supplier quotations are required for comparison",
      409,
    );
  }

  if (quotations.length > 100) {
    throw createError(
      "This comparison exceeds the supported quotation limit",
      409,
    );
  }

  assertCommonAccountingBasis(quotations);

  const now = new Date();

  const rows = rfq.items.map((item) => ({
    rowKey: String(item.lineId),
    rfqLineId: item.lineId,
    productId: item.productId,
    productCode: item.productCode,
    productName: item.productName,
    productType: item.productType,
    unit: item.unit,
    requiredQuantity: item.quantity,
    specification: item.specification,
    offers: [],
  }));

  const rowMap = new Map(rows.map((row) => [row.rowKey, row]));

  const summaries = [];

  for (const quotation of quotations) {
    assertQuotationAmounts(quotation);

    if (
      !rfq.supplierIds.some((id) => String(id) === String(quotation.supplierId))
    ) {
      throw createError(
        `${quotation.quotationNumber} belongs to a supplier not invited to this RFQ`,
        409,
      );
    }

    const seenLines = new Set();
    const warnings = [];

    for (const item of quotation.items) {
      const key = String(item.rfqLineId);
      const row = rowMap.get(key);

      if (
        !row ||
        String(row.productId) !== String(item.productId) ||
        row.unit !== item.unit ||
        row.productType !== item.productType
      ) {
        throw createError(
          `Source line mismatch in ${quotation.quotationNumber}`,
          409,
        );
      }

      if (seenLines.has(key)) {
        throw createError(
          `Duplicate RFQ line in ${quotation.quotationNumber}`,
          409,
        );
      }

      seenLines.add(key);

      const quoted = quantityMilli(item.quantity);
      const required = quantityMilli(row.requiredQuantity);

      if (quoted > required) {
        throw createError(
          `Quoted quantity exceeds the RFQ quantity in ${quotation.quotationNumber}`,
          409,
        );
      }

      if (quoted < required) {
        warnings.push(`Partial quantity for ${row.productName}`);
      }

      row.offers.push(makeOffer(quotation, item));
    }

    for (const row of rows) {
      if (!seenLines.has(row.rowKey)) {
        warnings.push(`Missing quotation for ${row.productName}`);
      }
    }

    summaries.push(
      makeSummary(quotation, warnings.length === 0, warnings, now),
    );
  }

  const ranking = rankSummaries(summaries);

  return {
    comparisonMode: "RFQ",

    source: {
      rfqId: rfq._id,
      rfqNumber: rfq.rfqNumber,
      rfqVersion: rfq.__v,

      // DIRECT or REQUISITION origin of the RFQ.
      rfqCreationMode: rfq.creationMode,
    },

    currency: quotations[0].currency,
    taxMode: quotations[0].taxMode,

    quotationCount: quotations.length,
    rows,
    quotations: summaries,
    ranking,

    comparedAt: now,
  };
};

/* ==========================================
   DIRECT COMPARISON
   ========================================== */

const directLineMap = (quotation) => {
  const map = new Map();

  for (const item of quotation.items) {
    const key = String(item.productId);

    if (map.has(key)) {
      throw createError(
        `Direct comparison requires each product to appear once: ${quotation.quotationNumber}`,
        409,
      );
    }

    map.set(key, item);
  }

  return map;
};

const compareDirect = async (context, payload) => {
  if (
    !Array.isArray(payload.quotationIds) ||
    payload.quotationIds.length < 2 ||
    payload.quotationIds.length > 20
  ) {
    throw createError("Select between 2 and 20 direct quotations");
  }

  const ids = payload.quotationIds.map((id) => objectId(id, "quotationId"));

  if (new Set(ids.map(String)).size !== ids.length) {
    throw createError("Quotation IDs must be unique");
  }

  const quotations = await context.models.SupplierQuotation.find({
    tenantId: context.tenantId,
    _id: { $in: ids },
    creationMode: "DIRECT",
    status: "CREATED",
    isDeleted: false,
  }).lean();

  if (quotations.length !== ids.length) {
    throw createError(
      "Some selected quotations are missing, cancelled, not direct, or outside this tenant",
      409,
    );
  }

  // Preserve the user's selection order.
  const quotationMap = new Map(
    quotations.map((quotation) => [String(quotation._id), quotation]),
  );

  const ordered = ids.map((id) => quotationMap.get(String(id)));

  assertCommonAccountingBasis(ordered);

  for (const quotation of ordered) {
    assertQuotationAmounts(quotation);
  }

  const baseline = directLineMap(ordered[0]);

  const rows = [...baseline.entries()].map(([key, item]) => ({
    rowKey: key,
    rfqLineId: null,
    productId: item.productId,
    productCode: item.productCode,
    productName: item.productName,
    productType: item.productType,
    unit: item.unit,
    requiredQuantity: item.quantity,
    specification: item.specification,
    offers: [],
  }));

  const now = new Date();
  const summaries = [];

  for (const quotation of ordered) {
    const items = directLineMap(quotation);

    if (items.size !== baseline.size) {
      throw createError(
        "Direct quotations must contain the same product basket",
        409,
      );
    }

    for (const row of rows) {
      const item = items.get(row.rowKey);

      if (
        !item ||
        item.unit !== row.unit ||
        item.productType !== row.productType ||
        quantityMilli(item.quantity) !== quantityMilli(row.requiredQuantity)
      ) {
        throw createError(
          `Products, units, types, or quantities differ in ${quotation.quotationNumber}`,
          409,
        );
      }

      row.offers.push(makeOffer(quotation, item));
    }

    summaries.push(makeSummary(quotation, true, [], now));
  }

  const ranking = rankSummaries(summaries);

  return {
    comparisonMode: "DIRECT",
    source: null,

    currency: ordered[0].currency,
    taxMode: ordered[0].taxMode,

    quotationCount: ordered.length,
    rows,
    quotations: summaries,
    ranking,

    comparedAt: now,
  };
};

/* ==========================================
   ENTRY POINT
   ========================================== */

const compareQuotations = async (args) => {
  const context = resolveContext(args);
  const payload = args.payload || {};

  if (payload.comparisonMode === "RFQ") {
    return compareRfq(context, payload);
  }

  if (payload.comparisonMode === "DIRECT") {
    return compareDirect(context, payload);
  }

  throw createError("Invalid comparison mode");
};

module.exports = {
  compareQuotations,
};
