const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const { rupeesToPaise } = require("../accounting/journals/journal.service");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const BUCKETS = ["notDue", "d1_30", "d31_60", "d61_90", "d90plus"];
const DAY_MS = 86400000;

const CONFIG = {
  PAYABLE: {
    modelKey: "PurchaseBill",
    partyIdField: "supplierId",
    partyCodeField: "supplierCode",
    partyNameField: "supplierName",
    numberField: "billNumber",
    dateField: "billDate",
    ledgerType: "SUPPLIER",
    ledgerNormal: "CREDIT",
  },
  RECEIVABLE: {
    modelKey: "SalesInvoice",
    partyIdField: "customerId",
    partyCodeField: "customerCode",
    partyNameField: "customerName",
    numberField: "invoiceNumber",
    dateField: "invoiceDate",
    ledgerType: "CUSTOMER",
    ledgerNormal: "DEBIT",
  },
};

const resolveAsOf = (value) => {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) throw createError("asOfDate is invalid");

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
};

const getModels = (connection, cfg) => {
  const models = getTenantAccountingModels(connection);

  const Model =
    models[cfg.modelKey] ||
    (connection.models[cfg.modelKey] ? connection.model(cfg.modelKey) : null);

  if (!Model) {
    throw createError(`${cfg.modelKey} is not registered`, 500);
  }

  return { Model, Ledger: models.Ledger };
};

const matchStage = ({ tenantId, cfg, asOf }) => ({
  tenantId,
  isDeleted: false,
  status: "POSTED",
  outstandingAmountPaise: { $gt: 0 },
  [cfg.dateField]: { $lte: asOf },
});

// Works on every MongoDB version (no $dateDiff).
const ageingStages = (asOf) => [
  {
    $addFields: {
      daysOverdue: {
        $floor: { $divide: [{ $subtract: [asOf, "$dueDate"] }, DAY_MS] },
      },
    },
  },
  {
    $addFields: {
      bucket: {
        $switch: {
          branches: [
            { case: { $lte: ["$daysOverdue", 0] }, then: "notDue" },
            { case: { $lte: ["$daysOverdue", 30] }, then: "d1_30" },
            { case: { $lte: ["$daysOverdue", 60] }, then: "d31_60" },
            { case: { $lte: ["$daysOverdue", 90] }, then: "d61_90" },
          ],
          default: "d90plus",
        },
      },
    },
  },
];

const bucketSums = () =>
  Object.fromEntries(
    BUCKETS.map((bucket) => [
      bucket,
      {
        $sum: {
          $cond: [{ $eq: ["$bucket", bucket] }, "$outstandingAmountPaise", 0],
        },
      },
    ]),
  );

const getLedgerControlPaise = async ({ Ledger, tenantId, cfg }) => {
  const ledgers = await Ledger.find({
    tenantId,
    type: cfg.ledgerType,
    isActive: true,
  })
    .select("currentBalance currentBalanceType")
    .lean();

  return ledgers.reduce((sum, ledger) => {
    const paise = rupeesToPaise(ledger.currentBalance || 0);
    return ledger.currentBalanceType === cfg.ledgerNormal
      ? sum + paise
      : sum - paise;
  }, 0);
};

const getReport = async ({ tenant, connection, kind, asOfDate, overdueOnly }) => {
  const cfg = CONFIG[kind];
  const { Model, Ledger } = getModels(connection, cfg);

  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));
  const asOf = resolveAsOf(asOfDate);

  const [rows, ledgerControlPaise] = await Promise.all([
    Model.aggregate([
      { $match: matchStage({ tenantId, cfg, asOf }) },
      ...ageingStages(asOf),
      {
        $group: {
          _id: `$${cfg.partyIdField}`,
          partyCode: { $first: `$${cfg.partyCodeField}` },
          partyName: { $first: `$${cfg.partyNameField}` },
          documentCount: { $sum: 1 },
          totalAmountPaise: { $sum: "$totalAmountPaise" },
          paidAmountPaise: { $sum: "$paidAmountPaise" },
          outstandingAmountPaise: { $sum: "$outstandingAmountPaise" },
          oldestDueDate: { $min: "$dueDate" },
          ...bucketSums(),
        },
      },
      {
        $addFields: {
          overdueAmountPaise: { $subtract: ["$outstandingAmountPaise", "$notDue"] },
        },
      },
      ...(overdueOnly ? [{ $match: { overdueAmountPaise: { $gt: 0 } } }] : []),
      { $sort: { outstandingAmountPaise: -1, partyName: 1 } },
      { $addFields: { partyId: "$_id" } },
      { $project: { _id: 0 } },
      { $limit: 5000 },
    ]).allowDiskUse(true),
    getLedgerControlPaise({ Ledger, tenantId, cfg }),
  ]);

  const summary = rows.reduce(
    (result, row) => {
      result.partyCount += 1;
      result.documentCount += row.documentCount;
      result.outstandingAmountPaise += row.outstandingAmountPaise;
      result.overdueAmountPaise += row.overdueAmountPaise;
      BUCKETS.forEach((bucket) => {
        result.buckets[bucket] += row[bucket];
      });
      return result;
    },
    {
      partyCount: 0,
      documentCount: 0,
      outstandingAmountPaise: 0,
      overdueAmountPaise: 0,
      buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])),
    },
  );

  return {
    asOfDate: asOf.toISOString().slice(0, 10),
    data: rows,
    summary: {
      ...summary,
      // Difference = advances, opening balances or manual journals.
      ledgerControlPaise,
      ledgerDifferencePaise: ledgerControlPaise - summary.outstandingAmountPaise,
    },
  };
};

const getPartyDocuments = async ({ tenant, connection, kind, partyId, asOfDate }) => {
  if (!mongoose.isObjectIdOrHexString(partyId)) {
    throw createError("partyId must be a valid ObjectId");
  }

  const cfg = CONFIG[kind];
  const { Model } = getModels(connection, cfg);

  const tenantId = new mongoose.Types.ObjectId(String(tenant._id));
  const asOf = resolveAsOf(asOfDate);

  const data = await Model.aggregate([
    {
      $match: {
        ...matchStage({ tenantId, cfg, asOf }),
        [cfg.partyIdField]: new mongoose.Types.ObjectId(partyId),
      },
    },
    ...ageingStages(asOf),
    { $sort: { dueDate: 1 } },
    {
      $project: {
        number: `$${cfg.numberField}`,
        documentDate: `$${cfg.dateField}`,
        dueDate: 1,
        totalAmountPaise: 1,
        paidAmountPaise: 1,
        outstandingAmountPaise: 1,
        daysOverdue: { $max: ["$daysOverdue", 0] },
        bucket: 1,
      },
    },
    { $limit: 2000 },
  ]);

  return {
    asOfDate: asOf.toISOString().slice(0, 10),
    data,
    totalOutstandingPaise: data.reduce((s, d) => s + d.outstandingAmountPaise, 0),
  };
};

module.exports = { getReport, getPartyDocuments };