// src/modules/accounting/reports/outstanding.service.js
// Separate Customer (Sundry Debtors) and Supplier (Sundry Creditors) outstanding
// As-of-date, paise-safe, supports search + zero filter via query.

const mongoose = require("mongoose");
const { getTenantAccountingModels } = require("../../../tenancy/tenantAccountingModels");
const { rupeesToPaise, paiseToRupees } = require("../journals/journal.service");

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw createError(`${fieldName} must use YYYY-MM-DD format (got: "${String(value).slice(0, 30)}")`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw createError(`${fieldName} is invalid: ${v}`);
  return d;
};

const getTodayUTC = () => new Date().toISOString().slice(0, 10);

const getOutstanding = async ({ tenant, connection, query, type }) => {
  const { Journal, Ledger } = getTenantAccountingModels(connection);
  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

  const groupCode = type === "customer" ? "SUNDRY_DEBTORS" : "SUNDRY_CREDITORS";
  const rawDate = query.asOfDate ?? query.asOf ?? query.date ?? "";
  const effectiveDateStr = normalizeDateParam(rawDate) || getTodayUTC();
  const asOf = parseDate(effectiveDateStr, "asOfDate");
  const asOfExclusive = new Date(asOf);
  asOfExclusive.setUTCDate(asOfExclusive.getUTCDate() + 1);

  // Find group
  const LedgerGroup = connection.model("LedgerGroup"); // tenant connection model
  let group = null;
  try {
    group = await LedgerGroup.findOne({ tenantId, code: groupCode, isActive: true }).select("_id").lean();
  } catch (_) {
    // fallback: try via getTenantAccountingModels if available
    const { LedgerGroup: LG } = (() => {
      try { return getTenantAccountingModels(connection); } catch { return {}; }
    })();
    if (LG) group = await LG.findOne({ tenantId, code: groupCode }).select("_id").lean();
  }

  if (!group) {
    // No group -> return empty
    return {
      asOfDate: effectiveDateStr,
      timezone: "UTC",
      groupCode,
      totals: type === "customer"
        ? { totalReceivable: 0, totalAdvance: 0, netReceivable: 0, count: 0 }
        : { totalPayable: 0, totalAdvance: 0, netPayable: 0, count: 0 },
      rows: [],
    };
  }

  // All ledgers under group (customers or suppliers)
  const ledgers = await Ledger.find({ tenantId, ledgerGroupId: group._id })
    .populate("ledgerGroupId", "code name")
    .sort({ name: 1 })
    .lean();

  if (!ledgers.length) {
    return {
      asOfDate: effectiveDateStr,
      timezone: "UTC",
      groupCode,
      totals: type === "customer"
        ? { totalReceivable: 0, totalAdvance: 0, netReceivable: 0, count: 0 }
        : { totalPayable: 0, totalAdvance: 0, netPayable: 0, count: 0 },
      rows: [],
    };
  }

  const ledgerIdSet = ledgers.map((l) => l._id);
  const movements = await Journal.aggregate([
    { $match: { tenantId, postingDate: { $lt: asOfExclusive }, eventType: "POST", "lines.ledgerId": { $in: ledgerIdSet } } },
    { $unwind: "$lines" },
    { $match: { "lines.ledgerId": { $in: ledgerIdSet } } },
    { $group: { _id: "$lines.ledgerId", debitPaise: { $sum: "$lines.debitPaise" }, creditPaise: { $sum: "$lines.creditPaise" } } },
  ]);
  const moveMap = new Map(movements.map((m) => [String(m._id), { debitPaise: Number(m.debitPaise || 0), creditPaise: Number(m.creditPaise || 0) }]));

  // Optional: pull customer/supplier master for display (code, phone) — best effort
  let masterMap = new Map();
  try {
    const CustomerOrSupplier = type === "customer"
      ? connection.model("Customer")
      : connection.model("Supplier");
    const masters = await CustomerOrSupplier.find({ tenantId, ledgerId: { $in: ledgerIdSet }, isDeleted: false })
      .select("ledgerId customerCode supplierCode customerName supplierName name phone mobile gstNo gstin")
      .lean();
    masterMap = new Map(masters.map((m) => [String(m.ledgerId), m]));
  } catch (_) {
    // try global models
    try {
      const GlobalModel = type === "customer" ? mongoose.model("Customer") : mongoose.model("Supplier");
      const masters = await GlobalModel.find({ tenantId, ledgerId: { $in: ledgerIdSet } }).select("ledgerId customerCode supplierCode customerName supplierName name phone").lean();
      masterMap = new Map(masters.map((m) => [String(m.ledgerId), m]));
    } catch (_) { /* ignore */ }
  }

  let totalReceivablePaise = 0;
  let totalAdvancePaise = 0;
  let totalPayablePaise = 0;
  let totalSupAdvancePaise = 0;

  const rows = [];

  for (const ledger of ledgers) {
    const openingPaise = rupeesToPaise(ledger.openingBalance || 0, `Ledger ${ledger.code} opening`);
    const openingSigned = ledger.openingBalanceType === "CREDIT" ? -openingPaise : openingPaise;
    const move = moveMap.get(String(ledger._id)) || { debitPaise: 0, creditPaise: 0 };
    const signedPaise = openingSigned + Number(move.debitPaise || 0) - Number(move.creditPaise || 0);
    if (!Number.isSafeInteger(signedPaise)) throw createError("Balance exceeds supported range", 409);

    const balance = paiseToRupees(signedPaise); // positive=Dr, negative=Cr
    const master = masterMap.get(String(ledger._id));

    if (type === "customer") {
      if (signedPaise > 0) totalReceivablePaise += signedPaise;
      if (signedPaise < 0) totalAdvancePaise += Math.abs(signedPaise);
    } else {
      if (signedPaise < 0) totalPayablePaise += Math.abs(signedPaise);
      if (signedPaise > 0) totalSupAdvancePaise += signedPaise;
    }

    rows.push({
      _id: ledger._id,
      ledgerId: ledger._id,
      code: ledger.code,
      name: ledger.name,
      groupCode: ledger.ledgerGroupId?.code || groupCode,
      groupName: ledger.ledgerGroupId?.name || "",
      customerCode: master?.customerCode || "",
      supplierCode: master?.supplierCode || "",
      customerName: master?.customerName || master?.name || ledger.name,
      supplierName: master?.supplierName || master?.name || ledger.name,
      phone: master?.phone || master?.mobile || "",
      balance,
      amount: balance,
      balancePaise: signedPaise,
      ledgerCode: ledger.code,
    });
  }

  // Sort by abs amount desc
  rows.sort((a, b) => Math.abs(Number(b.balance || 0)) - Math.abs(Number(a.balance || 0)));

  return {
    asOfDate: effectiveDateStr,
    timezone: "UTC",
    groupCode,
    totals: type === "customer"
      ? {
          totalReceivable: paiseToRupees(totalReceivablePaise),
          totalAdvance: paiseToRupees(totalAdvancePaise),
          netReceivable: paiseToRupees(totalReceivablePaise - totalAdvancePaise),
          totalReceivablePaise,
          totalAdvancePaise,
          netReceivablePaise: totalReceivablePaise - totalAdvancePaise,
          count: rows.length,
        }
      : {
          totalPayable: paiseToRupees(totalPayablePaise),
          totalAdvance: paiseToRupees(totalSupAdvancePaise),
          netPayable: paiseToRupees(totalPayablePaise - totalSupAdvancePaise),
          totalPayablePaise,
          totalAdvancePaise: totalSupAdvancePaise,
          netPayablePaise: totalPayablePaise - totalSupAdvancePaise,
          count: rows.length,
        },
    rows,
  };
};

const getCustomerOutstanding = (args) => getOutstanding({ ...args, type: "customer" });
const getSupplierOutstanding = (args) => getOutstanding({ ...args, type: "supplier" });

module.exports = { getOutstanding, getCustomerOutstanding, getSupplierOutstanding };
