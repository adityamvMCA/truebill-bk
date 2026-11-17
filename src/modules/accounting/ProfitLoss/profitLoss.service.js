const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const DAY_MS = 86400000;
const MAX_RANGE_DAYS = 400;
const MAX_TIME_MS = 30000;

/**
 * Journals with these sourceTypes are not trading activity and are left out
 * of the P&L. Change the value to match what your opening-balance / closing
 * entries use (leave the array empty if you have none).
 */
const EXCLUDED_SOURCE_TYPES = ["OPENING_BALANCE"];

// Which side is "profit" for each section.
const SECTION_SIDE = {
  SALES: "CREDIT",
  DIRECT_INCOME: "CREDIT",
  INDIRECT_INCOME: "CREDIT",
  PURCHASE: "DEBIT",
  DIRECT_EXPENSE: "DEBIT",
  INDIRECT_EXPENSE: "DEBIT",
};

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const parseDate = (value, fieldName) => {
  const text = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${fieldName} must use YYYY-MM-DD format`);
  }

  const date = new Date(`${text}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const isoDay = (date) => date.toISOString().slice(0, 10);

const safe = (value) => {
  if (!Number.isSafeInteger(value)) {
    throw createError("Amount exceeds the supported range", 409);
  }

  return value;
};

/**
 * Decides which P&L section a ledger belongs to, from its group and name.
 * Adjust the patterns to your seeded ledger groups if anything lands in the
 * wrong place (Direct/Indirect groups are matched first).
 */
const classifyLedger = (ledger) => {
  const group =
    ledger.ledgerGroupId && typeof ledger.ledgerGroupId === "object"
      ? ledger.ledgerGroupId
      : null;

  const groupText = `${group?.code || ""} ${group?.name || ""}`.toLowerCase();
  const nameText = String(ledger.name || "").toLowerCase();

  if (ledger.nature === "INCOME") {
    if (/purchase[\s_-]*return/.test(nameText)) return "PURCHASE";
    if (/indirect[\s_-]*inc/.test(groupText)) return "INDIRECT_INCOME";
    if (/direct[\s_-]*inc/.test(groupText)) return "DIRECT_INCOME";
    if (/sales|revenue/.test(groupText) || /^sales\b/.test(nameText)) {
      return "SALES";
    }

    return "INDIRECT_INCOME";
  }

  if (/sales[\s_-]*return/.test(nameText)) return "SALES";
  if (/indirect[\s_-]*exp/.test(groupText)) return "INDIRECT_EXPENSE";
  if (/direct[\s_-]*exp/.test(groupText)) return "DIRECT_EXPENSE";
  if (/purchase/.test(groupText) || /^purchase/.test(nameText)) {
    return "PURCHASE";
  }

  return "INDIRECT_EXPENSE";
};

const aggregatePeriod = async ({ Journal, tenantId, ledgerIds, from, to }) => {
  if (!ledgerIds.length) return new Map();

  const match = {
    tenantId,
    eventType: "POST",
    postingDate: { $gte: from, $lt: new Date(to.getTime() + DAY_MS) },
    "lines.ledgerId": { $in: ledgerIds },
  };

  if (EXCLUDED_SOURCE_TYPES.length) {
    match.sourceType = { $nin: EXCLUDED_SOURCE_TYPES };
  }

  const rows = await Journal.aggregate([
    { $match: match },
    { $unwind: "$lines" },
    { $match: { "lines.ledgerId": { $in: ledgerIds } } },
    {
      $group: {
        _id: "$lines.ledgerId",
        debitPaise: { $sum: "$lines.debitPaise" },
        creditPaise: { $sum: "$lines.creditPaise" },
      },
    },
  ]).option({ allowDiskUse: true, maxTimeMS: MAX_TIME_MS });

  return new Map(rows.map((row) => [String(row._id), row]));
};

const amountFor = (section, totals) => {
  if (!totals) return 0;

  const debit = Number(totals.debitPaise) || 0;
  const credit = Number(totals.creditPaise) || 0;

  return safe(SECTION_SIDE[section] === "CREDIT" ? credit - debit : debit - credit);
};

const getProfitLoss = async ({ tenant, fromDate, toDate, compare }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("Invalid tenant context");
  }

  const models = getTenantAccountingModels(getReadyTenantConnection(tenant));
  const { Ledger, LedgerGroup, Journal } = models;

  for (const [name, model] of Object.entries({ Ledger, LedgerGroup, Journal })) {
    if (!model) throw createError(`Tenant model ${name} is unavailable`, 500);
  }

  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));

  const from = parseDate(fromDate, "fromDate");
  const to = parseDate(toDate, "toDate");

  if (from > to) throw createError("fromDate cannot be after toDate");

  const days = Math.round((to - from) / DAY_MS) + 1;

  if (days > MAX_RANGE_DAYS) {
    throw createError(`Period cannot be longer than ${MAX_RANGE_DAYS} days`);
  }

  const withCompare = String(compare) === "true";

  let previousPeriod = null;

  if (withCompare) {
    const prevTo = new Date(from.getTime() - DAY_MS);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * DAY_MS);

    previousPeriod = {
      fromDate: isoDay(prevFrom),
      toDate: isoDay(prevTo),
      from: prevFrom,
      to: prevTo,
    };
  }

  const ledgers = await Ledger.find({
    tenantId: tenantObjectId,
    nature: { $in: ["INCOME", "EXPENSE"] },
  })
    .select("code name nature type isActive ledgerGroupId")
    .populate({
      path: "ledgerGroupId",
      model: LedgerGroup,
      select: "code name nature",
    })
    .lean();

  const ledgerIds = ledgers.map((ledger) => ledger._id);

  const [current, previous] = await Promise.all([
    aggregatePeriod({ Journal, tenantId: tenantObjectId, ledgerIds, from, to }),
    previousPeriod
      ? aggregatePeriod({
          Journal,
          tenantId: tenantObjectId,
          ledgerIds,
          from: previousPeriod.from,
          to: previousPeriod.to,
        })
      : Promise.resolve(new Map()),
  ]);

  const rows = [];

  for (const ledger of ledgers) {
    const key = String(ledger._id);
    const hasActivity = current.has(key) || previous.has(key);

    // Hide inactive ledgers that did nothing in either period.
    if (!ledger.isActive && !hasActivity) continue;

    const section = classifyLedger(ledger);

    rows.push({
      _id: key,
      code: ledger.code,
      name: ledger.name,
      nature: ledger.nature,
      section,
      groupCode: ledger.ledgerGroupId?.code || null,
      groupName: ledger.ledgerGroupId?.name || null,
      amountPaise: amountFor(section, current.get(key)),
      previousPaise: previousPeriod ? amountFor(section, previous.get(key)) : 0,
    });
  }

  rows.sort(
    (a, b) =>
      String(a.groupName || "").localeCompare(String(b.groupName || "")) ||
      String(a.name).localeCompare(String(b.name)),
  );

  return {
    data: {
      period: { fromDate: isoDay(from), toDate: isoDay(to), days },
      previousPeriod: previousPeriod && {
        fromDate: previousPeriod.fromDate,
        toDate: previousPeriod.toDate,
      },
      compare: withCompare,
      timezone: "UTC",
      excludedSourceTypes: EXCLUDED_SOURCE_TYPES,
    },
    rows,
  };
};

module.exports = { getProfitLoss };
