// // // src/modules/accounting/journals/daybook.service.js
// // // Day Book service — follows your existing tenant + paise architecture

// // const mongoose = require("mongoose");
// // const { getTenantAccountingModels } = require("../../../../tenancy/tenantAccountingModels");
// // const { rupeesToPaise, paiseToRupees } = require("../journal.service");

// // const createError = (message, statusCode = 400) => {
// //   const e = new Error(message);
// //   e.statusCode = statusCode;
// //   return e;
// // };

// // const normalizeCode = (v) => String(v || "").trim().toUpperCase();

// // const parseDate = (value, fieldName) => {
// //   if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
// //     throw createError(`${fieldName} must use YYYY-MM-DD format`);
// //   }
// //   const d = new Date(`${value}T00:00:00.000Z`);
// //   if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
// //     throw createError(`${fieldName} is invalid`);
// //   }
// //   return d;
// // };

// // const parsePositiveInteger = (value, fallback, fieldName, maximum = Number.MAX_SAFE_INTEGER) => {
// //   if (value === undefined || value === null || value === "") return fallback;
// //   if (typeof value !== "string" && typeof value !== "number") throw createError(`${fieldName} must be a positive integer`);
// //   const s = String(value);
// //   if (!/^\d+$/.test(s)) throw createError(`${fieldName} must be a positive integer`);
// //   const n = Number(s);
// //   if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw createError(`${fieldName} must be between 1 and ${maximum}`);
// //   return n;
// // };

// // const ALLOWED_SOURCE_TYPES = ["PURCHASE_BILL", "SUPPLIER_PAYMENT", "MANUAL_JOURNAL", "SALES_INVOICE", "CUSTOMER_RECEIPT", "SALES_RETURN"];

// // const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// // const getDayBook = async ({ tenant, connection, query }) => {
// //   const { Journal } = getTenantAccountingModels(connection);
// //   const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

// //   const start = parseDate(query.startDate, "startDate");
// //   const end = parseDate(query.endDate, "endDate");
// //   if (start > end) throw createError("startDate cannot be after endDate");

// //   const endExclusive = new Date(end);
// //   endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

// //   const page = parsePositiveInteger(query.page, 1, "page");
// //   const limit = parsePositiveInteger(query.limit, 50, "limit", 200);
// //   const offset = (page - 1) * limit;

// //   const sourceType = query.sourceType ? normalizeCode(query.sourceType) : "";
// //   if (sourceType && !ALLOWED_SOURCE_TYPES.includes(sourceType)) throw createError(`sourceType must be one of: ${ALLOWED_SOURCE_TYPES.join(", ")}`);

// //   const search = String(query.search || "").trim();
// //   const sortBy = String(query.sortBy || "postingDate").trim();
// //   const sortOrder = String(query.sortOrder || "desc").toLowerCase();
// //   const sortDir = sortOrder === "asc" ? 1 : -1;

// //   const allowedSort = { postingDate: "postingDate", createdAt: "createdAt", journalNumber: "journalNumber", amount: "totalDebitPaise" };
// //   const sortField = allowedSort[sortBy] || "postingDate";

// //   const filter = {
// //     tenantId,
// //     postingDate: { $gte: start, $lt: endExclusive },
// //   };
// //   if (sourceType) filter.sourceType = sourceType;
// //   if (search) {
// //     const rx = new RegExp(escapeRegex(search), "i");
// //     // search across journalNumber, sourceNumber, narration and ledger names
// //     filter.$or = [
// //       { journalNumber: rx },
// //       { sourceNumber: rx },
// //       { narration: rx },
// //       { "lines.ledgerName": rx },
// //       { "lines.narration": rx },
// //     ];
// //   }

// //   const sort = { [sortField]: sortDir, _id: sortDir };

// //   const [count, totalsAgg, typeWiseAgg, rows] = await Promise.all([
// //     Journal.countDocuments(filter),
// //     Journal.aggregate([
// //       { $match: filter },
// //       { $group: { _id: null, count: { $sum: 1 }, debitPaise: { $sum: "$totalDebitPaise" }, creditPaise: { $sum: "$totalCreditPaise" } } },
// //     ]),
// //     Journal.aggregate([
// //       { $match: filter },
// //       { $group: { _id: "$sourceType", count: { $sum: 1 }, debitPaise: { $sum: "$totalDebitPaise" } } },
// //     ]),
// //     Journal.find(filter).sort(sort).skip(offset).limit(limit).lean(),
// //   ]);

// //   const t = totalsAgg[0] || { count: 0, debitPaise: 0, creditPaise: 0 };
// //   const totalPaise = Number(t.debitPaise || 0);

// //   const typeWise = {};
// //   for (const r of typeWiseAgg) typeWise[r._id] = Number(r.count || 0);
// //   // ensure all keys exist as 0
// //   for (const k of ALLOWED_SOURCE_TYPES) if (typeWise[k] === undefined) typeWise[k] = 0;

// //   const totalPages = Math.max(1, Math.ceil(count / limit));

// //   return {
// //     period: { startDate: String(query.startDate), endDate: String(query.endDate), timezone: "UTC" },
// //     totals: {
// //       count: Number(t.count || 0),
// //       debitPaise: Number(t.debitPaise || 0),
// //       creditPaise: Number(t.creditPaise || 0),
// //       // rupees for frontend convenience
// //       amount: paiseToRupees(totalPaise),
// //       debit: paiseToRupees(Number(t.debitPaise || 0)),
// //       credit: paiseToRupees(Number(t.creditPaise || 0)),
// //     },
// //     typeWise,
// //     transactions: rows.map((j) => ({
// //       _id: j._id,
// //       journalNumber: j.journalNumber,
// //       postingDate: j.postingDate,
// //       date: j.postingDate,
// //       createdAt: j.createdAt,
// //       sourceType: j.sourceType,
// //       sourceId: j.sourceId,
// //       sourceNumber: j.sourceNumber,
// //       reference: j.sourceNumber,
// //       voucherType: j.sourceType,
// //       narration: j.narration,
// //       description: j.narration,
// //       totalDebitPaise: j.totalDebitPaise,
// //       totalCreditPaise: j.totalCreditPaise,
// //       totalDebit: paiseToRupees(Number(j.totalDebitPaise || 0)),
// //       totalCredit: paiseToRupees(Number(j.totalCreditPaise || 0)),
// //       amount: paiseToRupees(Number(j.totalDebitPaise || 0)),
// //       lines: j.lines,
// //       currency: j.currency,
// //     })),
// //     pagination: {
// //       page,
// //       limit,
// //       total: count,
// //       totalPages,
// //       hasNextPage: page < totalPages,
// //       hasPreviousPage: page > 1,
// //     },
// //   };
// // };

// // module.exports = { getDayBook, ALLOWED_SOURCE_TYPES };


// // src/modules/accounting/journals/daybook.service.js
// // Day Book service — follows your existing tenant + paise architecture

// const mongoose = require("mongoose");
// const { getTenantAccountingModels } = require("../../../../tenancy/tenantAccountingModels");
// const { rupeesToPaise, paiseToRupees } = require("../journal.service");

// const createError = (message, statusCode = 400) => {
//   const e = new Error(message);
//   e.statusCode = statusCode;
//   return e;
// };

// const normalizeCode = (v) => String(v || "").trim().toUpperCase();

// const parseDate = (value, fieldName) => {
//   if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
//     throw createError(`${fieldName} must use YYYY-MM-DD format`);
//   }
//   const d = new Date(`${value}T00:00:00.000Z`);
//   if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
//     throw createError(`${fieldName} is invalid`);
//   }
//   return d;
// };

// const parsePositiveInteger = (value, fallback, fieldName, maximum = Number.MAX_SAFE_INTEGER) => {
//   if (value === undefined || value === null || value === "") return fallback;
//   if (typeof value !== "string" && typeof value !== "number") throw createError(`${fieldName} must be a positive integer`);
//   const s = String(value);
//   if (!/^\d+$/.test(s)) throw createError(`${fieldName} must be a positive integer`);
//   const n = Number(s);
//   if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw createError(`${fieldName} must be between 1 and ${maximum}`);
//   return n;
// };

// const ALLOWED_SOURCE_TYPES = ["PURCHASE_BILL", "SUPPLIER_PAYMENT", "MANUAL_JOURNAL", "SALES_INVOICE", "CUSTOMER_RECEIPT", "SALES_RETURN"];

// const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const getDayBook = async ({ tenant, connection, query }) => {
//   const { Journal } = getTenantAccountingModels(connection);
//   const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

//   const start = parseDate(query.startDate, "startDate");
//   const end = parseDate(query.endDate, "endDate");
//   if (start > end) throw createError("startDate cannot be after endDate");

//   const endExclusive = new Date(end);
//   endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

//   const page = parsePositiveInteger(query.page, 1, "page");
//   const limit = parsePositiveInteger(query.limit, 50, "limit", 200);
//   const offset = (page - 1) * limit;

//   const sourceType = query.sourceType ? normalizeCode(query.sourceType) : "";
//   if (sourceType && !ALLOWED_SOURCE_TYPES.includes(sourceType)) throw createError(`sourceType must be one of: ${ALLOWED_SOURCE_TYPES.join(", ")}`);

//   const search = String(query.search || "").trim();
//   const sortBy = String(query.sortBy || "postingDate").trim();
//   const sortOrder = String(query.sortOrder || "desc").toLowerCase();
//   const sortDir = sortOrder === "asc" ? 1 : -1;

//   const allowedSort = { postingDate: "postingDate", createdAt: "createdAt", journalNumber: "journalNumber", amount: "totalDebitPaise" };
//   const sortField = allowedSort[sortBy] || "postingDate";

//   const filter = {
//     tenantId,
//     postingDate: { $gte: start, $lt: endExclusive },
//   };
//   if (sourceType) filter.sourceType = sourceType;
//   if (search) {
//     const rx = new RegExp(escapeRegex(search), "i");
//     // search across journalNumber, sourceNumber, narration and ledger names
//     filter.$or = [
//       { journalNumber: rx },
//       { sourceNumber: rx },
//       { narration: rx },
//       { "lines.ledgerName": rx },
//       { "lines.narration": rx },
//     ];
//   }

//   const sort = { [sortField]: sortDir, _id: sortDir };

//   const [count, totalsAgg, typeWiseAgg, rows] = await Promise.all([
//     Journal.countDocuments(filter),
//     Journal.aggregate([
//       { $match: filter },
//       { $group: { _id: null, count: { $sum: 1 }, debitPaise: { $sum: "$totalDebitPaise" }, creditPaise: { $sum: "$totalCreditPaise" } } },
//     ]),
//     Journal.aggregate([
//       { $match: filter },
//       { $group: { _id: "$sourceType", count: { $sum: 1 }, debitPaise: { $sum: "$totalDebitPaise" } } },
//     ]),
//     Journal.find(filter).sort(sort).skip(offset).limit(limit).lean(),
//   ]);

//   const t = totalsAgg[0] || { count: 0, debitPaise: 0, creditPaise: 0 };
//   const totalPaise = Number(t.debitPaise || 0);

//   const typeWise = {};
//   for (const r of typeWiseAgg) typeWise[r._id] = Number(r.count || 0);
//   // ensure all keys exist as 0
//   for (const k of ALLOWED_SOURCE_TYPES) if (typeWise[k] === undefined) typeWise[k] = 0;

//   const totalPages = Math.max(1, Math.ceil(count / limit));

//   return {
//     period: { startDate: String(query.startDate), endDate: String(query.endDate), timezone: "UTC" },
//     totals: {
//       count: Number(t.count || 0),
//       debitPaise: Number(t.debitPaise || 0),
//       creditPaise: Number(t.creditPaise || 0),
//       // rupees for frontend convenience
//       amount: paiseToRupees(totalPaise),
//       debit: paiseToRupees(Number(t.debitPaise || 0)),
//       credit: paiseToRupees(Number(t.creditPaise || 0)),
//     },
//     typeWise,
//     transactions: rows.map((j) => ({
//       _id: j._id,
//       journalNumber: j.journalNumber,
//       postingDate: j.postingDate,
//       date: j.postingDate,
//       createdAt: j.createdAt,
//       sourceType: j.sourceType,
//       sourceId: j.sourceId,
//       sourceNumber: j.sourceNumber,
//       reference: j.sourceNumber,
//       voucherType: j.sourceType,
//       narration: j.narration,
//       description: j.narration,
//       totalDebitPaise: j.totalDebitPaise,
//       totalCreditPaise: j.totalCreditPaise,
//       totalDebit: paiseToRupees(Number(j.totalDebitPaise || 0)),
//       totalCredit: paiseToRupees(Number(j.totalCreditPaise || 0)),
//       amount: paiseToRupees(Number(j.totalDebitPaise || 0)),
//       lines: j.lines,
//       currency: j.currency,
//     })),
//     pagination: {
//       page,
//       limit,
//       total: count,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPreviousPage: page > 1,
//     },
//   };
// };

// /* =====================================================================
//    FAST VERSION (added) — everything above is unchanged.
//    getDayBookList    : one indexed, lean, paginated query
//    getDayBookSummary : one $group gives count + totals + type-wise counts
//    ===================================================================== */

// const FAST_SOURCE_TYPES = [
//   "PURCHASE_BILL", "SUPPLIER_PAYMENT", "MANUAL_JOURNAL", "SALES_INVOICE",
//   "CUSTOMER_RECEIPT", "SALES_RETURN", "PURCHASE_RETURN", "EXPENSE",
//   "CREDIT_NOTE", "DEBIT_NOTE", "TDS_DEDUCTION", "TDS_PAYMENT",
// ];
// const FAST_SORT_FIELDS = {
//   postingDate: "postingDate",
//   createdAt: "createdAt",
//   journalNumber: "journalNumber",
//   amount: "totalDebitPaise",
// };
// const PREVIEW_LINES = 4; // a journal can have 500 lines; the list never needs them all
// const MAX_TIME_MS = 20000;

// // journalNumber / sourceNumber are stored UPPERCASE -> case-sensitive ANCHORED
// // regex can use the index. Only the free-text parts scan.
// const buildSearchClauses = (search) => {
//   const prefix = new RegExp(`^${escapeRegex(search.toUpperCase())}`);
//   const clauses = [{ journalNumber: prefix }, { sourceNumber: prefix }];
//   if (search.length >= 3) {
//     const rx = new RegExp(escapeRegex(search), "i");
//     clauses.push({ narration: rx }, { "lines.ledgerName": rx });
//   }
//   return clauses;
// };

// const buildFastFilter = (tenant, query) => {
//   const tenantId = new mongoose.Types.ObjectId(String(tenant._id));
//   const start = parseDate(query.startDate, "startDate");
//   const end = parseDate(query.endDate, "endDate");
//   if (start > end) throw createError("startDate cannot be after endDate");

//   const endExclusive = new Date(end);
//   endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

//   const sourceType = query.sourceType ? normalizeCode(query.sourceType) : "";
//   if (sourceType && !FAST_SOURCE_TYPES.includes(sourceType)) {
//     throw createError(`sourceType must be one of: ${FAST_SOURCE_TYPES.join(", ")}`);
//   }

//   const search = String(query.search || "").trim().slice(0, 100);

//   const filter = { tenantId, postingDate: { $gte: start, $lt: endExclusive } };
//   if (sourceType) filter.sourceType = sourceType;
//   if (search) filter.$or = buildSearchClauses(search);
//   return filter;
// };

// /** LIST: indexed, sorted, skipped, limited. No count, no totals. */
// const getDayBookList = async ({ tenant, connection, query }) => {
//   const { Journal } = getTenantAccountingModels(connection);
//   const filter = buildFastFilter(tenant, query);

//   const page = parsePositiveInteger(query.page, 1, "page", 100000);
//   const limit = parsePositiveInteger(query.limit, 50, "limit", 200);
//   const dir = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
//   const sortField = FAST_SORT_FIELDS[String(query.sortBy || "postingDate").trim()] || "postingDate";

//   const docs = await Journal.aggregate([
//     { $match: filter },
//     { $sort: { [sortField]: dir, _id: dir } },
//     { $skip: (page - 1) * limit },
//     { $limit: limit },
//     {
//       // project AFTER limit: only one page of docs is reshaped
//       $project: {
//         journalNumber: 1, postingDate: 1, createdAt: 1, sourceType: 1,
//         sourceId: 1, sourceNumber: 1, narration: 1,
//         totalDebitPaise: 1, totalCreditPaise: 1, currency: 1,
//         lineCount: { $size: { $ifNull: ["$lines", []] } },
//         lines: {
//           $map: {
//             input: { $slice: [{ $ifNull: ["$lines", []] }, PREVIEW_LINES] },
//             as: "l",
//             in: { ledgerCode: "$$l.ledgerCode", ledgerName: "$$l.ledgerName", debitPaise: "$$l.debitPaise" },
//           },
//         },
//       },
//     },
//   ]).option({ maxTimeMS: MAX_TIME_MS });

//   const transactions = docs.map((j) => {
//     const preview = j.lines || [];
//     const extra = Math.max(0, (j.lineCount || 0) - preview.length);
//     const side = (l) => (l.debitPaise ? "Dr" : "Cr");
//     const lineText =
//       preview.map((l) => `${l.ledgerName} ${side(l)}`).join(" / ") +
//       (extra ? ` / +${extra} more` : "");
//     const codes =
//       preview.map((l) => `${l.ledgerCode} ${side(l)}`).join(" · ") +
//       (extra ? ` · +${extra}` : "");
//     return {
//       _id: j._id,
//       journalNumber: j.journalNumber,
//       postingDate: j.postingDate,
//       createdAt: j.createdAt,
//       sourceType: j.sourceType,
//       sourceId: j.sourceId,
//       sourceNumber: j.sourceNumber,
//       narration: j.narration,
//       particulars: j.narration || lineText || "—",
//       ledgerCodes: codes,
//       lineCount: j.lineCount,
//       totalDebitPaise: j.totalDebitPaise,
//       totalCreditPaise: j.totalCreditPaise,
//       currency: j.currency,
//     };
//   });

//   return {
//     transactions,
//     pagination: { page, limit, hasNextPage: docs.length === limit },
//   };
// };

// /** SUMMARY: ONE group-by-sourceType gives count, totals and type-wise counts. */
// const getDayBookSummary = async ({ tenant, connection, query }) => {
//   const { Journal } = getTenantAccountingModels(connection);
//   const filter = buildFastFilter(tenant, query);

//   const groups = await Journal.aggregate([
//     { $match: filter },
//     {
//       $group: {
//         _id: "$sourceType",
//         count: { $sum: 1 },
//         debitPaise: { $sum: "$totalDebitPaise" },
//         creditPaise: { $sum: "$totalCreditPaise" },
//       },
//     },
//   ]).option({ maxTimeMS: MAX_TIME_MS });

//   const typeWise = Object.fromEntries(FAST_SOURCE_TYPES.map((k) => [k, 0]));
//   let count = 0;
//   let debitPaise = 0;
//   let creditPaise = 0;
//   for (const g of groups) {
//     typeWise[g._id] = Number(g.count || 0);
//     count += Number(g.count || 0);
//     debitPaise += Number(g.debitPaise || 0);
//     creditPaise += Number(g.creditPaise || 0);
//   }

//   return {
//     period: { startDate: String(query.startDate), endDate: String(query.endDate), timezone: "UTC" },
//     totals: {
//       count,
//       debitPaise,
//       creditPaise,
//       amount: paiseToRupees(debitPaise),
//       debit: paiseToRupees(debitPaise),
//       credit: paiseToRupees(creditPaise),
//     },
//     typeWise,
//   };
// };

// module.exports = { getDayBook, getDayBookList, getDayBookSummary, ALLOWED_SOURCE_TYPES };// src/modules/accounting/journals/daybook.service.js
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

/* =====================================================================
   FAST VERSION (added) — everything above is unchanged.
   getDayBookList    : one indexed, lean, paginated query
   getDayBookSummary : one $group gives count + totals + type-wise counts
   ===================================================================== */

const FAST_SOURCE_TYPES = [
  "PURCHASE_BILL", "SUPPLIER_PAYMENT", "MANUAL_JOURNAL", "SALES_INVOICE",
  "CUSTOMER_RECEIPT", "SALES_RETURN", "PURCHASE_RETURN", "EXPENSE",
  "CREDIT_NOTE", "DEBIT_NOTE", "TDS_DEDUCTION", "TDS_PAYMENT",
];
const FAST_SORT_FIELDS = {
  postingDate: "postingDate",
  createdAt: "createdAt",
  journalNumber: "journalNumber",
  amount: "totalDebitPaise",
};
const PREVIEW_LINES = 4; // a journal can have 500 lines; the list never needs them all
const MAX_TIME_MS = 20000;

// journalNumber / sourceNumber are stored UPPERCASE -> case-sensitive ANCHORED
// regex can use the index. Only the free-text parts scan.
const buildSearchClauses = (search) => {
  const prefix = new RegExp(`^${escapeRegex(search.toUpperCase())}`);
  const clauses = [{ journalNumber: prefix }, { sourceNumber: prefix }];
  if (search.length >= 3) {
    const rx = new RegExp(escapeRegex(search), "i");
    clauses.push({ narration: rx }, { "lines.ledgerName": rx });
  }
  return clauses;
};

const buildFastFilter = (tenant, query) => {
  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));
  const start = parseDate(query.startDate, "startDate");
  const end = parseDate(query.endDate, "endDate");
  if (start > end) throw createError("startDate cannot be after endDate");

  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const sourceType = query.sourceType ? normalizeCode(query.sourceType) : "";
  if (sourceType && !FAST_SOURCE_TYPES.includes(sourceType)) {
    throw createError(`sourceType must be one of: ${FAST_SOURCE_TYPES.join(", ")}`);
  }

  const search = String(query.search || "").trim().slice(0, 100);

  const filter = { tenantId, postingDate: { $gte: start, $lt: endExclusive } };
  if (sourceType) filter.sourceType = sourceType;
  if (search) filter.$or = buildSearchClauses(search);
  return filter;
};

/** LIST: indexed, sorted, skipped, limited. No count, no totals. */
const getDayBookList = async ({ tenant, connection, query }) => {
  const { Journal } = getTenantAccountingModels(connection);
  const filter = buildFastFilter(tenant, query);

  const page = parsePositiveInteger(query.page, 1, "page", 100000);
  const limit = parsePositiveInteger(query.limit, 50, "limit", 200);
  const dir = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
  const sortField = FAST_SORT_FIELDS[String(query.sortBy || "postingDate").trim()] || "postingDate";

  const docs = await Journal.aggregate([
    { $match: filter },
    { $sort: { [sortField]: dir, _id: dir } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    {
      // project AFTER limit: only one page of docs is reshaped
      $project: {
        journalNumber: 1, postingDate: 1, createdAt: 1, sourceType: 1,
        sourceId: 1, sourceNumber: 1, narration: 1,
        totalDebitPaise: 1, totalCreditPaise: 1, currency: 1,
        lineCount: { $size: { $ifNull: ["$lines", []] } },
        lines: {
          $map: {
            input: { $slice: [{ $ifNull: ["$lines", []] }, PREVIEW_LINES] },
            as: "l",
            in: { ledgerCode: "$$l.ledgerCode", ledgerName: "$$l.ledgerName", debitPaise: "$$l.debitPaise" },
          },
        },
      },
    },
  ]).option({ maxTimeMS: MAX_TIME_MS });

  const transactions = docs.map((j) => {
    const preview = j.lines || [];
    const extra = Math.max(0, (j.lineCount || 0) - preview.length);
    const side = (l) => (l.debitPaise ? "Dr" : "Cr");
    const lineText =
      preview.map((l) => `${l.ledgerName} ${side(l)}`).join(" / ") +
      (extra ? ` / +${extra} more` : "");
    const codes =
      preview.map((l) => `${l.ledgerCode} ${side(l)}`).join(" · ") +
      (extra ? ` · +${extra}` : "");
    const moreText = extra ? ` / +${extra} more` : "";
    return {
      _id: j._id,
      journalNumber: j.journalNumber,
      postingDate: j.postingDate,
      createdAt: j.createdAt,
      sourceType: j.sourceType,
      sourceId: j.sourceId,
      sourceNumber: j.sourceNumber,
      narration: j.narration,
      ledgerNames: preview.map((l) => l.ledgerName).filter(Boolean).join(" / ") + (preview.length ? moreText : ""),
      ledgerSummary: preview.map((l) => `${l.ledgerName} ${side(l)}`).join(", ") + (extra ? `, +${extra} more` : ""),
      particulars: j.narration || lineText || "—",
      ledgerCodes: codes,
      lineCount: j.lineCount,
      totalDebitPaise: j.totalDebitPaise,
      totalCreditPaise: j.totalCreditPaise,
      currency: j.currency,
    };
  });

  return {
    transactions,
    pagination: { page, limit, hasNextPage: docs.length === limit },
  };
};

/** SUMMARY: ONE group-by-sourceType gives count, totals and type-wise counts. */
const getDayBookSummary = async ({ tenant, connection, query }) => {
  const { Journal } = getTenantAccountingModels(connection);
  const filter = buildFastFilter(tenant, query);

  const groups = await Journal.aggregate([
    { $match: filter },
    {
      $group: {
        _id: "$sourceType",
        count: { $sum: 1 },
        debitPaise: { $sum: "$totalDebitPaise" },
        creditPaise: { $sum: "$totalCreditPaise" },
      },
    },
  ]).option({ maxTimeMS: MAX_TIME_MS });

  const typeWise = Object.fromEntries(FAST_SOURCE_TYPES.map((k) => [k, 0]));
  let count = 0;
  let debitPaise = 0;
  let creditPaise = 0;
  for (const g of groups) {
    typeWise[g._id] = Number(g.count || 0);
    count += Number(g.count || 0);
    debitPaise += Number(g.debitPaise || 0);
    creditPaise += Number(g.creditPaise || 0);
  }

  return {
    period: { startDate: String(query.startDate), endDate: String(query.endDate), timezone: "UTC" },
    totals: {
      count,
      debitPaise,
      creditPaise,
      amount: paiseToRupees(debitPaise),
      debit: paiseToRupees(debitPaise),
      credit: paiseToRupees(creditPaise),
    },
    typeWise,
  };
};

module.exports = { getDayBook, getDayBookList, getDayBookSummary, ALLOWED_SOURCE_TYPES };