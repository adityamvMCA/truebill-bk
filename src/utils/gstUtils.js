const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../tenancy/tenantConnectionManager");

const TAX_HEADS = ["CGST", "SGST", "IGST"];

const HEAD_KEYS = {
  CGST: "cgstPaise",
  SGST: "sgstPaise",
  IGST: "igstPaise",
};

const OUTPUT_LEDGER_FIELDS = {
  CGST: "outputCgstLedgerId",
  SGST: "outputSgstLedgerId",
  IGST: "outputIgstLedgerId",
};

const INPUT_LEDGER_FIELDS = {
  CGST: "inputCgstLedgerId",
  SGST: "inputSgstLedgerId",
  IGST: "inputIgstLedgerId",
};

/**
 * Journals that must NOT count towards GST.
 * Adjust the status values to match your Journal schema.
 * Documents without a `status` field still match ($nin ignores missing fields).
 * Do NOT add "REVERSED" here if reversals are posted as separate journals,
 * otherwise the reversal would be counted without its original.
 */
const JOURNAL_ACTIVE_FILTER = {
  isDeleted: { $ne: true },
  status: { $nin: ["DRAFT", "CANCELLED", "VOID"] },
};

const MAX_RANGE_DAYS = 366;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Dates are treated as UTC calendar days.
 * Make sure postingDate / invoiceDate / returnDate are stored the same way
 * (UTC midnight of the business date). If you store IST midnight
 * (18:30Z previous day) the first of each month will land in the wrong period.
 */
const parseDate = (value, fieldName, endOfDay = false) => {
  const text = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${fieldName} must be a valid date (YYYY-MM-DD)`);
  }

  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${text}T${time}Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const parsePeriod = (fromDate, toDate, { maxDays } = {}) => {
  const from = parseDate(fromDate, "fromDate");
  const to = parseDate(toDate, "toDate", true);

  if (from > to) {
    throw createError("fromDate cannot be after toDate");
  }

  if (maxDays && (to - from) / 86400000 > maxDays) {
    throw createError(`Date range cannot be longer than ${maxDays} days`);
  }

  return { from, to };
};

const parsePaging = ({ page, limit }, defaultLimit = 10, maxLimit = 100) => ({
  currentPage: Math.max(Number.parseInt(page, 10) || 1, 1),
  pageLimit: Math.min(
    Math.max(Number.parseInt(limit, 10) || defaultLimit, 1),
    maxLimit,
  ),
});

const resolveContext = ({ tenant, required = [] }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("tenantId must be a valid ObjectId");
  }

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of required) {
    if (!models[name]) {
      throw createError(`Tenant model ${name} is unavailable`, 500);
    }
  }

  return {
    models,
    tenantObjectId: new mongoose.Types.ObjectId(String(tenantId)),
  };
};

module.exports = {
  TAX_HEADS,
  HEAD_KEYS,
  OUTPUT_LEDGER_FIELDS,
  INPUT_LEDGER_FIELDS,
  JOURNAL_ACTIVE_FILTER,
  MAX_RANGE_DAYS,
  createError,
  normalizeText,
  escapeRegex,
  parseDate,
  parsePeriod,
  parsePaging,
  resolveContext,
};