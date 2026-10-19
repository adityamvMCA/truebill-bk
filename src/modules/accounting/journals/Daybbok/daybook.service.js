// src/modules/accounting/journals/daybook.service.js
// Day Book service — follows your existing tenant + paise architecture

const mongoose = require("mongoose");
const { getTenantAccountingModels } = require("../../../../tenancy/tenantAccountingModels");
const { rupeesToPaise, paiseToRupees } = require("../journal.service");

const createError = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const normalizeCode = (v) => String(v || "").trim().toUpperCase();

const parseDate = (value, fieldName) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(`${fieldName} must use YYYY-MM-DD format`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw createError(`${fieldName} is invalid`);
  }
  return d;
};

const parsePositiveInteger = (value, fallback, fieldName, maximum = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw createError(`${fieldName} must be a positive integer`);
  const s = String(value);
  if (!/^\d+$/.test(s)) throw createError(`${fieldName} must be a positive integer`);
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw createError(`${fieldName} must be between 1 and ${maximum}`);
  return n;
};

const ALLOWED_SOURCE_TYPES = ["PURCHASE_BILL", "SUPPLIER_PAYMENT", "MANUAL_JOURNAL", "SALES_INVOICE", "CUSTOMER_RECEIPT", "SALES_RETURN"];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getDayBook = async ({ tenant, connection, query }) => {
  const { Journal } = getTenantAccountingModels(connection);
  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

  const start = parseDate(query.startDate, "startDate");
  const end = parseDate(query.endDate, "endDate");
  if (start > end) throw createError("startDate cannot be after endDate");

  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const page = parsePositiveInteger(query.page, 1, "page");
  const limit = parsePositiveInteger(query.limit, 50, "limit", 200);
  const offset = (page - 1) * limit;

  const sourceType = query.sourceType ? normalizeCode(query.sourceType) : "";
  if (sourceType && !ALLOWED_SOURCE_TYPES.includes(sourceType)) throw createError(`sourceType must be one of: ${ALLOWED_SOURCE_TYPES.join(", ")}`);

  const search = String(query.search || "").trim();
  const sortBy = String(query.sortBy || "postingDate").trim();
  const sortOrder = String(query.sortOrder || "desc").toLowerCase();
  const sortDir = sortOrder === "asc" ? 1 : -1;

  const allowedSort = { postingDate: "postingDate", createdAt: "createdAt", journalNumber: "journalNumber", amount: "totalDebitPaise" };
  const sortField = allowedSort[sortBy] || "postingDate";

  const filter = {
    tenantId,
    postingDate: { $gte: start, $lt: endExclusive },
  };
  if (sourceType) filter.sourceType = sourceType;
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    // search across journalNumber, sourceNumber, narration and ledger names
    filter.$or = [
      { journalNumber: rx },
      { sourceNumber: rx },
      { narration: rx },
      { "lines.ledgerName": rx },
      { "lines.narration": rx },
    ];
  }

  const sort = { [sortField]: sortDir, _id: sortDir };

  const [count, totalsAgg, typeWiseAgg, rows] = await Promise.all([
    Journal.countDocuments(filter),
    Journal.aggregate([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 }, debitPaise: { $sum: "$totalDebitPaise" }, creditPaise: { $sum: "$totalCreditPaise" } } },
    ]),
    Journal.aggregate([
      { $match: filter },
      { $group: { _id: "$sourceType", count: { $sum: 1 }, debitPaise: { $sum: "$totalDebitPaise" } } },
    ]),
    Journal.find(filter).sort(sort).skip(offset).limit(limit).lean(),
  ]);

  const t = totalsAgg[0] || { count: 0, debitPaise: 0, creditPaise: 0 };
  const totalPaise = Number(t.debitPaise || 0);

  const typeWise = {};
  for (const r of typeWiseAgg) typeWise[r._id] = Number(r.count || 0);
  // ensure all keys exist as 0
  for (const k of ALLOWED_SOURCE_TYPES) if (typeWise[k] === undefined) typeWise[k] = 0;

  const totalPages = Math.max(1, Math.ceil(count / limit));

  return {
    period: { startDate: String(query.startDate), endDate: String(query.endDate), timezone: "UTC" },
    totals: {
      count: Number(t.count || 0),
      debitPaise: Number(t.debitPaise || 0),
      creditPaise: Number(t.creditPaise || 0),
      // rupees for frontend convenience
      amount: paiseToRupees(totalPaise),
      debit: paiseToRupees(Number(t.debitPaise || 0)),
      credit: paiseToRupees(Number(t.creditPaise || 0)),
    },
    typeWise,
    transactions: rows.map((j) => ({
      _id: j._id,
      journalNumber: j.journalNumber,
      postingDate: j.postingDate,
      date: j.postingDate,
      createdAt: j.createdAt,
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      sourceNumber: j.sourceNumber,
      reference: j.sourceNumber,
      voucherType: j.sourceType,
      narration: j.narration,
      description: j.narration,
      totalDebitPaise: j.totalDebitPaise,
      totalCreditPaise: j.totalCreditPaise,
      totalDebit: paiseToRupees(Number(j.totalDebitPaise || 0)),
      totalCredit: paiseToRupees(Number(j.totalCreditPaise || 0)),
      amount: paiseToRupees(Number(j.totalDebitPaise || 0)),
      lines: j.lines,
      currency: j.currency,
    })),
    pagination: {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

module.exports = { getDayBook, ALLOWED_SOURCE_TYPES };
