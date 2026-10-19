// src/modules/accounting/reports/trialBalance.service.js — FIXED
// Handles: missing asOfDate, ISO datetime, trimming, and empty string

const mongoose = require("mongoose");
const { getTenantAccountingModels } = require("../../../../tenancy/tenantAccountingModels");
const { rupeesToPaise, paiseToRupees } = require("../../journals/journal.service");

const createError = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const normalizeDateParam = (value) => {
  if (value === undefined || value === null) return "";
  let v = String(value).trim();
  if (!v) return "";
  // Handle ISO datetime: 2026-10-19T00:00:00.000Z -> 2026-10-19
  if (v.includes("T")) v = v.split("T")[0];
  // Handle slash format: 2026/10/19 -> 2026-10-19
  if (v.includes("/")) v = v.replace(/\//g, "-");
  return v;
};

const parseDate = (value, fieldName) => {
  const v = normalizeDateParam(value);
  if (!v) {
    throw createError(`${fieldName} is required (YYYY-MM-DD)`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw createError(`${fieldName} must use YYYY-MM-DD format (got: "${String(value).slice(0, 30)}")`);
  }
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw createError(`${fieldName} is invalid: ${v}`);
  }
  return d;
};

const normalizeCode = (v) => String(v || "").trim().toUpperCase();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALLOWED_NATURES = ["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"];

// Fallback to today UTC if client sends empty string (e.g. cleared date input)
const getTodayUTC = () => new Date().toISOString().slice(0, 10);

const getTrialBalance = async ({ tenant, connection, query }) => {
  const { Journal, Ledger } = getTenantAccountingModels(connection);
  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

  // Accept both asOfDate and asOf / date / toDate for compatibility with older frontend
  const rawDate = query.asOfDate ?? query.asOf ?? query.date ?? query.toDate ?? "";
  const effectiveDateStr = normalizeDateParam(rawDate) || getTodayUTC();

  const asOf = parseDate(effectiveDateStr, "asOfDate");
  const asOfExclusive = new Date(asOf);
  asOfExclusive.setUTCDate(asOfExclusive.getUTCDate() + 1);

  const nature = query.nature ? normalizeCode(query.nature) : "";
  if (nature && !ALLOWED_NATURES.includes(nature)) {
    throw createError(`nature must be one of: ${ALLOWED_NATURES.join(", ")}`);
  }

  const includeZero = String(query.includeZero ?? "true").toLowerCase() !== "false";
  const search = String(query.search || "").trim();

  const ledgerFilter = { tenantId };
  if (nature) ledgerFilter.nature = nature;

  let ledgers = await Ledger.find(ledgerFilter)
    .populate("ledgerGroupId", "code name")
    .sort({ code: 1 })
    .lean();

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    ledgers = ledgers.filter(
      (l) =>
        rx.test(l.code || "") ||
        rx.test(l.name || "") ||
        rx.test(l.ledgerGroupId?.name || "") ||
        rx.test(l.ledgerGroupId?.code || "")
    );
  }

  if (!ledgers.length) {
    return {
      asOfDate: effectiveDateStr,
      timezone: "UTC",
      totals: { debit: 0, credit: 0, debitPaise: 0, creditPaise: 0, isBalanced: true, difference: 0, differencePaise: 0 },
      rows: [],
      count: 0,
    };
  }

  const ledgerIdSet = ledgers.map((l) => l._id);

  const movements = await Journal.aggregate([
    {
      $match: {
        tenantId,
        postingDate: { $lt: asOfExclusive },
        eventType: "POST",
        "lines.ledgerId": { $in: ledgerIdSet },
      },
    },
    { $unwind: "$lines" },
    { $match: { "lines.ledgerId": { $in: ledgerIdSet } } },
    {
      $group: {
        _id: "$lines.ledgerId",
        debitPaise: { $sum: "$lines.debitPaise" },
        creditPaise: { $sum: "$lines.creditPaise" },
      },
    },
  ]);

  const moveMap = new Map(
    movements.map((m) => [String(m._id), { debitPaise: Number(m.debitPaise || 0), creditPaise: Number(m.creditPaise || 0) }])
  );

  let totalDebitPaise = 0;
  let totalCreditPaise = 0;
  const rows = [];

  for (const ledger of ledgers) {
    const openingPaise = rupeesToPaise(ledger.openingBalance || 0, `Ledger ${ledger.code} opening balance`);
    const openingSigned = ledger.openingBalanceType === "CREDIT" ? -openingPaise : openingPaise;
    const move = moveMap.get(String(ledger._id)) || { debitPaise: 0, creditPaise: 0 };
    const signedPaise = openingSigned + Number(move.debitPaise || 0) - Number(move.creditPaise || 0);
    if (!Number.isSafeInteger(signedPaise)) throw createError("Ledger balance exceeds the supported range", 409);
    if (!includeZero && signedPaise === 0) continue;

    const isDebit = signedPaise > 0;
    const isCredit = signedPaise < 0;
    const debit = isDebit ? paiseToRupees(signedPaise) : 0;
    const credit = isCredit ? paiseToRupees(Math.abs(signedPaise)) : 0;
    if (isDebit) totalDebitPaise += signedPaise;
    if (isCredit) totalCreditPaise += Math.abs(signedPaise);

    rows.push({
      _id: ledger._id,
      code: ledger.code,
      name: ledger.name,
      nature: ledger.nature,
      normalBalance: ledger.normalBalance,
      groupId: ledger.ledgerGroupId?._id || null,
      groupCode: ledger.ledgerGroupId?.code || "",
      groupName: ledger.ledgerGroupId?.name || "",
      debit,
      credit,
      debitPaise: isDebit ? signedPaise : 0,
      creditPaise: isCredit ? Math.abs(signedPaise) : 0,
      balance: isDebit ? debit : isCredit ? credit : 0,
      balancePaise: Math.abs(signedPaise),
      balanceType: signedPaise > 0 ? "Dr" : signedPaise < 0 ? "Cr" : ledger.normalBalance === "CREDIT" ? "Cr" : "Dr",
      signedPaise,
      isZero: signedPaise === 0,
    });
  }

  rows.sort((a, b) => {
    if (a.isZero !== b.isZero) return a.isZero ? 1 : -1;
    if ((a.signedPaise > 0) !== (b.signedPaise > 0)) return a.signedPaise > 0 ? -1 : 1;
    return String(a.code).localeCompare(String(b.code));
  });

  return {
    asOfDate: effectiveDateStr,
    timezone: "UTC",
    totals: {
      debit: paiseToRupees(totalDebitPaise),
      credit: paiseToRupees(totalCreditPaise),
      debitPaise: totalDebitPaise,
      creditPaise: totalCreditPaise,
      isBalanced: totalDebitPaise === totalCreditPaise,
      differencePaise: Math.abs(totalDebitPaise - totalCreditPaise),
      difference: paiseToRupees(Math.abs(totalDebitPaise - totalCreditPaise)),
    },
    rows,
    count: rows.length,
  };
};

module.exports = { getTrialBalance, ALLOWED_NATURES };