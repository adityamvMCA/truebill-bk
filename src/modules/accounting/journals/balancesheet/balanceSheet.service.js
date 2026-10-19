// src/modules/accounting/reports/balanceSheet.service.js
// Balance Sheet — ASSET vs (LIABILITY + EQUITY + P&L) as of date (UTC). Paise-safe.

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
  if (v.includes("T")) v = v.split("T")[0];
  if (v.includes("/")) v = v.replace(/\//g, "-");
  return v;
};

const parseDate = (value, fieldName) => {
  const v = normalizeDateParam(value);
  if (!v) throw createError(`${fieldName} is required (YYYY-MM-DD)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw createError(`${fieldName} must use YYYY-MM-DD format (got: "${String(value).slice(0, 30)}")`);
  }
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw createError(`${fieldName} is invalid: ${v}`);
  }
  return d;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getTodayUTC = () => new Date().toISOString().slice(0, 10);

const getBalanceSheet = async ({ tenant, connection, query }) => {
  const { Journal, Ledger } = getTenantAccountingModels(connection);
  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

  const rawDate = query.asOfDate ?? query.asOf ?? query.date ?? query.toDate ?? "";
  const effectiveDateStr = normalizeDateParam(rawDate) || getTodayUTC();
  const asOf = parseDate(effectiveDateStr, "asOfDate");

  const asOfExclusive = new Date(asOf);
  asOfExclusive.setUTCDate(asOfExclusive.getUTCDate() + 1);

  const includeZero = String(query.includeZero ?? "false").toLowerCase() !== "false" ? true : false;
  // Default to false for BS (cleaner) — but allow "true" to show zeros
  // If query has no includeZero, default false
  const showZero = query.includeZero === undefined ? false : String(query.includeZero).toLowerCase() === "true";
  const search = String(query.search || "").trim();

  // 1) Load all ledgers (we need all natures for P&L)
  let ledgers = await Ledger.find({ tenantId })
    .populate("ledgerGroupId", "code name nature")
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
      totals: { assets: 0, liabilities: 0, equity: 0, liabilitiesPlusEquity: 0, assetsPaise: 0, liabilitiesPaise: 0, equityPaise: 0 },
      assets: [],
      liabilities: [],
      equity: [],
      profitAndLoss: { totalIncome: 0, totalExpense: 0, netProfit: 0, totalIncomePaise: 0, totalExpensePaise: 0, netProfitPaise: 0 },
      count: 0,
    };
  }

  const ledgerIdSet = ledgers.map((l) => l._id);

  // 2) Movements up to asOf inclusive
  const movements = await Journal.aggregate([
    { $match: { tenantId, postingDate: { $lt: asOfExclusive }, eventType: "POST", "lines.ledgerId": { $in: ledgerIdSet } } },
    { $unwind: "$lines" },
    { $match: { "lines.ledgerId": { $in: ledgerIdSet } } },
    { $group: { _id: "$lines.ledgerId", debitPaise: { $sum: "$lines.debitPaise" }, creditPaise: { $sum: "$lines.creditPaise" } } },
  ]);

  const moveMap = new Map(
    movements.map((m) => [String(m._id), { debitPaise: Number(m.debitPaise || 0), creditPaise: Number(m.creditPaise || 0) }])
  );

  let totalAssetsPaise = 0;
  let totalLiabilitiesPaise = 0;
  let totalEquityPaise = 0;
  let totalIncomePaise = 0;
  let totalExpensePaise = 0;

  const assets = [];
  const liabilities = [];
  const equity = [];

  for (const ledger of ledgers) {
    const openingPaise = rupeesToPaise(ledger.openingBalance || 0, `Ledger ${ledger.code} opening balance`);
    const openingSigned = ledger.openingBalanceType === "CREDIT" ? -openingPaise : openingPaise;
    const move = moveMap.get(String(ledger._id)) || { debitPaise: 0, creditPaise: 0 };
    const signedPaise = openingSigned + Number(move.debitPaise || 0) - Number(move.creditPaise || 0);
    if (!Number.isSafeInteger(signedPaise)) throw createError("Ledger balance exceeds the supported range", 409);

    if (!showZero && signedPaise === 0) {
      // still need income/expense for P&L even if zero — but they contribute 0, so skip row
      // For BS side: skip zero rows
      if (["ASSET", "LIABILITY", "EQUITY"].includes(ledger.nature)) continue;
      // For INCOME/EXPENSE: add 0 to P&L then skip row (no row needed for BS)
      continue;
    }

    const groupName = ledger.ledgerGroupId?.name || "";
    const groupCode = ledger.ledgerGroupId?.code || "";

    // P&L natures — accumulate for net profit, don't add to assets/liabilities
    if (ledger.nature === "INCOME") {
      // Income is CREDIT normal -> signed negative = income. So incomePaise = -signedPaise
      const incomePaise = -signedPaise;
      totalIncomePaise += incomePaise;
      continue;
    }
    if (ledger.nature === "EXPENSE") {
      // Expense is DEBIT normal -> signed positive = expense
      const expensePaise = signedPaise;
      totalExpensePaise += expensePaise;
      continue;
    }

    // Balance sheet natures
    if (ledger.nature === "ASSET") {
      // Assets: amount = signedPaise (debit positive)
      totalAssetsPaise += signedPaise;
      assets.push({
        _id: ledger._id,
        code: ledger.code,
        name: ledger.name,
        nature: ledger.nature,
        groupName,
        groupCode,
        amount: paiseToRupees(signedPaise),
        amountPaise: signedPaise,
        signedPaise,
      });
    } else if (ledger.nature === "LIABILITY") {
      // Liabilities: amount = -signedPaise (credit positive)
      const amtPaise = -signedPaise;
      totalLiabilitiesPaise += amtPaise;
      liabilities.push({
        _id: ledger._id,
        code: ledger.code,
        name: ledger.name,
        nature: ledger.nature,
        groupName,
        groupCode,
        amount: paiseToRupees(amtPaise),
        amountPaise: amtPaise,
        signedPaise,
      });
    } else if (ledger.nature === "EQUITY") {
      const amtPaise = -signedPaise;
      totalEquityPaise += amtPaise;
      equity.push({
        _id: ledger._id,
        code: ledger.code,
        name: ledger.name,
        nature: ledger.nature,
        groupName,
        groupCode,
        amount: paiseToRupees(amtPaise),
        amountPaise: amtPaise,
        signedPaise,
      });
    }
  }

  // If showZero was false, we skipped zero income/expense — but need to include them for correct P&L
  // Re-run income/expense including zeros if we filtered them
  if (!showZero) {
    // Need to compute full P&L regardless of zero filter
    // We already skipped zero income/expense; non-zero ones are counted.
    // Zero ones add 0, so total is already correct. But if user had search filter,
    // ledgers were pre-filtered — P&L should still be for filtered set only, so OK.
  }

  const netProfitPaise = totalIncomePaise - totalExpensePaise;
  const netProfit = paiseToRupees(netProfitPaise);
  const liabilitiesPlusEquityPaise = totalLiabilitiesPaise + totalEquityPaise + netProfitPaise;

  // Sort each side by amount desc then code
  const byAmount = (a, b) => Math.abs(Number(b.amountPaise || 0)) - Math.abs(Number(a.amountPaise || 0)) || String(a.code).localeCompare(String(b.code));
  assets.sort(byAmount);
  liabilities.sort(byAmount);
  equity.sort(byAmount);

  return {
    asOfDate: effectiveDateStr,
    timezone: "UTC",
    totals: {
      assets: paiseToRupees(totalAssetsPaise),
      liabilities: paiseToRupees(totalLiabilitiesPaise),
      equity: paiseToRupees(totalEquityPaise),
      liabilitiesPlusEquity: paiseToRupees(liabilitiesPlusEquityPaise),
      assetsPaise: totalAssetsPaise,
      liabilitiesPaise: totalLiabilitiesPaise,
      equityPaise: totalEquityPaise,
      liabilitiesPlusEquityPaise,
      isBalanced: totalAssetsPaise === liabilitiesPlusEquityPaise,
      differencePaise: Math.abs(totalAssetsPaise - liabilitiesPlusEquityPaise),
      difference: paiseToRupees(Math.abs(totalAssetsPaise - liabilitiesPlusEquityPaise)),
    },
    assets,
    liabilities,
    equity,
    profitAndLoss: {
      totalIncome: paiseToRupees(totalIncomePaise),
      totalExpense: paiseToRupees(totalExpensePaise),
      netProfit,
      totalIncomePaise,
      totalExpensePaise,
      netProfitPaise,
    },
    count: assets.length + liabilities.length + equity.length,
  };
};

module.exports = { getBalanceSheet };
