const mongoose = require("mongoose");

const { getTenantAccountingModels } = require("../../../tenancy/tenantAccountingModels");
const { getNextSequence } = require("../../../utils/sequenceGenerator");
const { postJournal } = require("../../accounting/journals/journal.service");
const { DEDUCTEE_TYPES } = require("./tds.models");

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

const createError = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};
const text = (v) => String(v ?? "").trim();
const oid = (v, name) => {
  if (!mongoose.isObjectIdOrHexString(v)) throw createError(`${name} must be a valid ObjectId`);
  return new mongoose.Types.ObjectId(String(v));
};
const date = (v, name) => {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw createError(`${name} is invalid`);
  return d;
};

// Indian FY, April to March, using the stored UTC date.
const financialYear = (d) => {
  const start = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

/**
 * Pure calculation, same order of checks as Tally:
 *  1. rate from Nature of Payment by deductee type; PAN missing -> "without PAN" rate
 *  2. Section 197 certificate overrides the rate
 *  3. thresholds: nil while under BOTH the per-payment and the annual limit
 *  4. when the annual limit is crossed, earlier nil-deduction amounts are caught up
 */
const calculateTds = ({
  nature, deducteeType, pan, basePaise,
  cumulativeBasePaise = 0, undeductedBasePaise = 0, certificate = null,
}) => {
  const slab =
    nature.rates.find((r) => r.deducteeType === deducteeType) ||
    nature.rates.find((r) => r.deducteeType === "ALL");
  if (!slab) throw createError(`No rate set for ${deducteeType} under section ${nature.section}`, 409);

  let ratePercent = PAN_RE.test(text(pan).toUpperCase()) ? slab.withPanPercent : slab.withoutPanPercent;
  let reason = "DEDUCTED";

  if (certificate) {
    ratePercent = certificate.ratePercent;
    reason = "LOWER_RATE_CERTIFICATE";
  }

  const single = nature.singleThresholdPaise || 0;
  const annual = nature.annualThresholdPaise || 0;
  const overSingle = single > 0 && basePaise > single;
  const overAnnual = annual > 0 && cumulativeBasePaise + basePaise > annual;

  if ((single > 0 || annual > 0) && !overSingle && !overAnnual) {
    return { ratePercent, taxableBasePaise: basePaise, tdsPaise: 0, reason: "BELOW_THRESHOLD" };
  }

  const taxableBasePaise = basePaise + (overAnnual ? undeductedBasePaise : 0);
  const tdsPaise = Math.round((taxableBasePaise * ratePercent) / 100);
  return { ratePercent, taxableBasePaise, tdsPaise, reason };
};

const loadNature = async (models, tenantId, natureId, onDate, session) => {
  const nature = await models.TdsNature.findOne({ _id: oid(natureId, "natureId"), tenantId, isActive: true })
    .session(session || null).lean();
  if (!nature) throw createError("Nature of payment not found", 404);
  if (onDate < nature.effectiveFrom || (nature.effectiveTo && onDate > nature.effectiveTo)) {
    throw createError(`Section ${nature.section} is not effective on this date`, 409);
  }
  return nature;
};

const loadHistory = async (models, { tenantId, partyLedgerId, natureId, fy, session }) => {
  const rows = await models.TdsDeduction.find({ tenantId, partyLedgerId, natureId, financialYear: fy })
    .session(session || null).select("baseAmountPaise tdsPaise").lean();
  return {
    cumulativeBasePaise: rows.reduce((t, r) => t + r.baseAmountPaise, 0),
    undeductedBasePaise: rows.filter((r) => r.tdsPaise === 0).reduce((t, r) => t + r.baseAmountPaise, 0),
  };
};

const parseInput = (body) => {
  const deducteeType = text(body.deducteeType).toUpperCase();
  if (!DEDUCTEE_TYPES.includes(deducteeType)) throw createError("Unsupported deductee type");
  const pan = text(body.pan).toUpperCase() || null;
  if (pan && !PAN_RE.test(pan)) throw createError("PAN is not valid");
  if (!Number.isSafeInteger(body.baseAmountPaise) || body.baseAmountPaise < 1) {
    throw createError("baseAmountPaise must be a positive integer");
  }
  let certificate = null;
  if (body.certificate) {
    const rate = Number(body.certificate.ratePercent);
    if (!text(body.certificate.number) || !(rate >= 0 && rate <= 100)) {
      throw createError("A lower-rate certificate needs a number and a rate between 0 and 100");
    }
    certificate = { number: text(body.certificate.number), ratePercent: rate };
  }
  return { deducteeType, pan, certificate };
};

/** Preview only. Use from expense / bill / payment screens before they post. */
const previewTds = async ({ tenant, connection, body }) => {
  const models = getTenantAccountingModels(connection);
  const tenantId = oid(tenant?._id ?? tenant?.id, "tenantId");
  const { deducteeType, pan, certificate } = parseInput(body);
  const on = date(body.date, "date");

  const nature = await loadNature(models, tenantId, body.natureId, on);
  const history = await loadHistory(models, {
    tenantId, partyLedgerId: oid(body.partyLedgerId, "partyLedgerId"), natureId: nature._id, fy: financialYear(on),
  });

  return {
    section: nature.section,
    financialYear: financialYear(on),
    ...history,
    ...calculateTds({ nature, deducteeType, pan, basePaise: body.baseAmountPaise, certificate, ...history }),
  };
};

/**
 * Standalone deduction ("deduct later" in Tally):
 *   Dr Party ledger (payable falls)   Cr TDS payable ledger
 * Use recordDeduction() instead when the expense / bill voucher posts the TDS line itself.
 */
const deductTds = async ({ tenant, connection, userId, body, session }) => {
  const models = getTenantAccountingModels(connection);
  const tenantId = oid(tenant?._id ?? tenant?.id, "tenantId");
  const { deducteeType, pan, certificate } = parseInput(body);
  const on = date(body.date, "date");
  const partyLedgerId = oid(body.partyLedgerId, "partyLedgerId");
  const partyName = text(body.partyName);
  if (!partyName) throw createError("partyName is required");

  const nature = await loadNature(models, tenantId, body.natureId, on, session);
  const fy = financialYear(on);
  const history = await loadHistory(models, { tenantId, partyLedgerId, natureId: nature._id, fy, session });
  const result = calculateTds({ nature, deducteeType, pan, basePaise: body.baseAmountPaise, certificate, ...history });

  if (result.tdsPaise < 1) throw createError("No TDS is deductible on this amount (below threshold)", 409);

  const id = new mongoose.Types.ObjectId();
  const number = await getNextSequence("TD", tenantId.toString(), 3, { connection, session });

  const journal = await postJournal({
    tenant, connection, userId,
    postingDate: on,
    sourceType: "TDS_DEDUCTION",
    sourceId: id,
    sourceNumber: number,
    narration: `TDS u/s ${nature.section} on ${partyName}`,
    lines: [
      { ledgerId: partyLedgerId, debitPaise: result.tdsPaise, creditPaise: 0 },
      { ledgerId: nature.tdsLedgerId, debitPaise: 0, creditPaise: result.tdsPaise },
    ],
    session,
  });

  const [row] = await models.TdsDeduction.create([{
    _id: id, tenantId, deductionNumber: number, financialYear: fy, deductionDate: on,
    partyLedgerId, partyName, pan, deducteeType,
    natureId: nature._id, section: nature.section,
    baseAmountPaise: body.baseAmountPaise, taxableBasePaise: result.taxableBasePaise,
    ratePercent: result.ratePercent, tdsPaise: result.tdsPaise, reason: result.reason,
    certificateNumber: certificate?.number || null,
    sourceType: "TDS_DEDUCTION", sourceId: id, sourceNumber: number,
    originalDocNumber: text(body.originalDocNumber).toUpperCase() || null,
    originalDocDate: body.originalDocDate ? date(body.originalDocDate, "originalDocDate") : null,
    journalId: journal._id, depositStatus: "PENDING", createdBy: userId,
  }], { session, ordered: true });

  return row;
};

/**
 * Called by the expense / purchase-bill / supplier-payment module INSIDE its own transaction,
 * after it has posted a journal that already contains the TDS credit line.
 * Stores the deduction (even nil ones) so thresholds and the register stay correct.
 */
const recordDeduction = async ({ tenant, connection, userId, session, input }) => {
  const models = getTenantAccountingModels(connection);
  const tenantId = oid(tenant?._id ?? tenant?.id, "tenantId");
  const on = date(input.date, "date");
  const number = await getNextSequence("TD", tenantId.toString(), 3, { connection, session });

  const [row] = await models.TdsDeduction.create([{
    tenantId, deductionNumber: number, financialYear: financialYear(on), deductionDate: on,
    partyLedgerId: oid(input.partyLedgerId, "partyLedgerId"), partyName: input.partyName,
    pan: input.pan || null, deducteeType: input.deducteeType,
    natureId: oid(input.natureId, "natureId"), section: input.section,
    baseAmountPaise: input.baseAmountPaise, taxableBasePaise: input.taxableBasePaise,
    ratePercent: input.ratePercent, tdsPaise: input.tdsPaise, reason: input.reason,
    certificateNumber: input.certificateNumber || null,
    sourceType: input.sourceType, sourceId: oid(input.sourceId, "sourceId"), sourceNumber: input.sourceNumber,
    journalId: input.journalId || null,
    depositStatus: input.tdsPaise > 0 ? "PENDING" : "NOT_DUE", createdBy: userId,
  }], { session, ordered: true });

  return row;
};

/**
 * Statutory payment (Tally: Payment voucher, "TDS payment").
 *   Dr TDS payable ledger   Cr Bank
 */
const payChallan = async ({ tenant, connection, userId, body, session }) => {
  const models = getTenantAccountingModels(connection);
  const tenantId = oid(tenant?._id ?? tenant?.id, "tenantId");

  const ids = [...new Set((body.deductionIds || []).map((v) => String(oid(v, "deductionId"))))]
    .map((v) => new mongoose.Types.ObjectId(v));
  if (!ids.length) throw createError("Select at least one deduction to deposit");

  const rows = await models.TdsDeduction.find({
    _id: { $in: ids }, tenantId, depositStatus: "PENDING", tdsPaise: { $gt: 0 },
  }).session(session).lean();
  if (rows.length !== ids.length) {
    throw createError("One or more deductions are missing, already deposited, or have no TDS", 409);
  }

  const natures = await models.TdsNature.find({ tenantId, _id: { $in: rows.map((r) => r.natureId) } })
    .session(session).lean();
  const ledgerByNature = new Map(natures.map((n) => [String(n._id), String(n.tdsLedgerId)]));

  const perLedger = new Map();
  for (const r of rows) {
    const ledgerId = ledgerByNature.get(String(r.natureId));
    if (!ledgerId) throw createError("A nature of payment on these deductions no longer exists", 409);
    perLedger.set(ledgerId, (perLedger.get(ledgerId) || 0) + r.tdsPaise);
  }
  const total = rows.reduce((t, r) => t + r.tdsPaise, 0);

  const bsrCode = text(body.bsrCode);
  if (!/^\d{7}$/.test(bsrCode)) throw createError("BSR code must be 7 digits");
  const serial = text(body.challanSerialNo);
  if (!serial) throw createError("Challan serial number is required");
  const depositDate = date(body.depositDate, "depositDate");

  const id = new mongoose.Types.ObjectId();
  const number = await getNextSequence("TP", tenantId.toString(), 3, { connection, session });

  const journal = await postJournal({
    tenant, connection, userId,
    postingDate: depositDate,
    sourceType: "TDS_PAYMENT",
    sourceId: id,
    sourceNumber: number,
    narration: `TDS deposited, BSR ${bsrCode}, challan ${serial}`,
    lines: [
      ...[...perLedger].map(([ledgerId, amt]) => ({ ledgerId, debitPaise: amt, creditPaise: 0 })),
      { ledgerId: oid(body.bankLedgerId, "bankLedgerId"), debitPaise: 0, creditPaise: total },
    ],
    session,
  });

  const [challan] = await models.TdsChallan.create([{
    _id: id, tenantId, challanNumber: number, bsrCode, challanSerialNo: serial, depositDate,
    bankLedgerId: oid(body.bankLedgerId, "bankLedgerId"), deductionIds: ids,
    totalTdsPaise: total, journalId: journal._id, createdBy: userId,
  }], { session, ordered: true });

  await models.TdsDeduction.updateMany(
    { _id: { $in: ids }, tenantId },
    { $set: { depositStatus: "DEPOSITED", challanId: id } },
    { session },
  );

  return challan;
};

const createNature = async ({ tenant, connection, userId, body }) => {
  const models = getTenantAccountingModels(connection);
  const tenantId = oid(tenant?._id ?? tenant?.id, "tenantId");
  return models.TdsNature.create({
    tenantId,
    section: text(body.section).toUpperCase(),
    paymentCode: text(body.paymentCode) || null,
    name: text(body.name),
    rates: body.rates,
    singleThresholdPaise: body.singleThresholdPaise || 0,
    annualThresholdPaise: body.annualThresholdPaise || 0,
    effectiveFrom: date(body.effectiveFrom, "effectiveFrom"),
    effectiveTo: body.effectiveTo ? date(body.effectiveTo, "effectiveTo") : null,
    tdsLedgerId: oid(body.tdsLedgerId, "tdsLedgerId"),
    createdBy: userId,
  });
};

const listNatures = async ({ tenant, connection }) => {
  const models = getTenantAccountingModels(connection);
  return models.TdsNature.find({ tenantId: oid(tenant?._id ?? tenant?.id, "tenantId"), isActive: true })
    .sort({ section: 1, effectiveFrom: -1 }).lean();
};

/** TDS register: what was deducted, what is still to be deposited. */
const getRegister = async ({ tenant, connection, fy, section, depositStatus, partyLedgerId, page = 1, limit = 25 }) => {
  const models = getTenantAccountingModels(connection);
  const tenantId = oid(tenant?._id ?? tenant?.id, "tenantId");
  const p = Math.max(Number.parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);

  const match = { tenantId };
  if (fy) match.financialYear = text(fy);
  if (section) match.section = text(section).toUpperCase();
  if (depositStatus) match.depositStatus = text(depositStatus).toUpperCase();
  if (partyLedgerId) match.partyLedgerId = oid(partyLedgerId, "partyLedgerId");

  const [data, total, sums] = await Promise.all([
    models.TdsDeduction.find(match).sort({ deductionDate: -1, _id: -1 }).skip((p - 1) * l).limit(l).lean(),
    models.TdsDeduction.countDocuments(match),
    models.TdsDeduction.aggregate([
      { $match: match },
      { $group: { _id: "$depositStatus", tdsPaise: { $sum: "$tdsPaise" } } },
    ]),
  ]);

  const by = Object.fromEntries(sums.map((s) => [s._id, s.tdsPaise]));
  return {
    data,
    totals: {
      deductedPaise: (by.PENDING || 0) + (by.DEPOSITED || 0),
      depositedPaise: by.DEPOSITED || 0,
      pendingDepositPaise: by.PENDING || 0,
    },
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

module.exports = {
  calculateTds, financialYear, previewTds, deductTds, recordDeduction,
  payChallan, createNature, listNatures, getRegister,
};
