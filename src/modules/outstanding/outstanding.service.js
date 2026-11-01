const mongoose = require("mongoose");

const { getTenantAccountingModels } = require("../../tenancy/tenantAccountingModels");
const { getReadyTenantConnection } = require("../../tenancy/tenantConnectionManager");

const REPORT_TIMEZONE = "Asia/Kolkata";

const CONFIG = {
  customer: {
    modelName: "SalesInvoice",
    partyId: "customerId",
    partyCode: "customerCode",
    partyName: "customerName",
    documentNumber: "invoiceNumber",
    documentDate: "invoiceDate",
  },
  supplier: {
    modelName: "PurchaseBill",
    partyId: "supplierId",
    partyCode: "supplierCode",
    partyName: "supplierName",
    documentNumber: "billNumber",
    documentDate: "billDate",
  },
};

const BUCKET_KEYS = ["notDue", "d1_30", "d31_60", "d61_90", "d90plus"];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ---------------- as-of date ---------------- */
const resolveAsOf = (asOfDate) => {
  if (asOfDate === undefined || asOfDate === null || asOfDate === "") {
    const now = new Date();
    return {
      reference: now,
      cutoff: null,
      label: now.toLocaleDateString("en-CA", { timeZone: REPORT_TIMEZONE }), // YYYY-MM-DD
    };
  }

  const check = new Date(`${asOfDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ||
    Number.isNaN(check.getTime()) ||
    check.toISOString().slice(0, 10) !== asOfDate
  ) {
    throw createError("asOfDate must be a valid YYYY-MM-DD date");
  }

  return {
    reference: new Date(`${asOfDate}T12:00:00.000+05:30`),
    cutoff: new Date(`${asOfDate}T23:59:59.999+05:30`),
    label: asOfDate,
  };
};

/* ---------------- shared setup ---------------- */
const prepare = ({ tenant, kind, partyId, search, asOfDate }) => {
  const config = CONFIG[kind];
  if (!config) throw createError("Invalid outstanding report type");

  const tenantId = tenant?._id;
  if (!mongoose.isObjectIdOrHexString(tenantId)) throw createError("Invalid tenantId");
  if (partyId && !mongoose.isObjectIdOrHexString(partyId)) throw createError("Invalid partyId");

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);
  const model = models[config.modelName];
  if (!model) throw createError(`Tenant model is missing: ${config.modelName}`, 500);

  const asOf = resolveAsOf(asOfDate);

  // Keep these three equalities + the $gt exactly as is: the partial indexes rely on them.
  const match = {
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    status: "POSTED",
    isDeleted: false,
    outstandingAmountPaise: { $gt: 0 },
  };

  if (asOf.cutoff) match[config.documentDate] = { $lte: asOf.cutoff };
  if (partyId) match[config.partyId] = new mongoose.Types.ObjectId(String(partyId));

  const text = String(search || "").trim();
  if (text) {
    const regex = { $regex: escapeRegex(text), $options: "i" };
    match.$or = [
      { [config.partyCode]: regex },
      { [config.partyName]: regex },
      { [config.documentNumber]: regex },
    ];
  }

  return { config, model, match, asOf };
};

/* match -> project -> ageing buckets (-> overdue filter) */
const buildBasePipeline = ({ config, match, reference, overdueOnly }) => {
  const bucket = (cond) => ({ $cond: [cond, "$outstandingAmountPaise", 0] });

  const pipeline = [
    { $match: match },
    {
      $project: {
        _id: 1,
        partyId: `$${config.partyId}`,
        partyCode: `$${config.partyCode}`,
        partyName: `$${config.partyName}`,
        documentNumber: `$${config.documentNumber}`,
        documentDate: `$${config.documentDate}`,
        dueDate: 1,
        totalAmountPaise: 1,
        paidAmountPaise: 1,
        outstandingAmountPaise: 1,
        paymentStatus: 1,
      },
    },
    {
      $set: {
        // No due date = treated as not due.
        overdueDays: {
          $cond: [
            { $eq: [{ $type: "$dueDate" }, "date"] },
            {
              $max: [
                0,
                {
                  $dateDiff: {
                    startDate: "$dueDate",
                    endDate: reference,
                    unit: "day",
                    timezone: REPORT_TIMEZONE,
                  },
                },
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $set: {
        overdueAmountPaise: bucket({ $gt: ["$overdueDays", 0] }),
        notDue: bucket({ $lte: ["$overdueDays", 0] }),
        d1_30: bucket({
          $and: [{ $gte: ["$overdueDays", 1] }, { $lte: ["$overdueDays", 30] }],
        }),
        d31_60: bucket({
          $and: [{ $gte: ["$overdueDays", 31] }, { $lte: ["$overdueDays", 60] }],
        }),
        d61_90: bucket({
          $and: [{ $gte: ["$overdueDays", 61] }, { $lte: ["$overdueDays", 90] }],
        }),
        d90plus: bucket({ $gt: ["$overdueDays", 90] }),
      },
    },
  ];

  if (overdueOnly) pipeline.push({ $match: { overdueDays: { $gt: 0 } } });

  return pipeline;
};

const sumFields = () => ({
  outstandingAmountPaise: { $sum: "$outstandingAmountPaise" },
  overdueAmountPaise: { $sum: "$overdueAmountPaise" },
  ...Object.fromEntries(BUCKET_KEYS.map((k) => [k, { $sum: `$${k}` }])),
});

const assertSafe = (records) => {
  for (const record of records) {
    for (const [key, value] of Object.entries(record || {})) {
      if (/Paise$/.test(key) || BUCKET_KEYS.includes(key)) {
        if (typeof value === "number" && !Number.isSafeInteger(value)) {
          throw createError("Outstanding totals exceed the supported range", 409);
        }
      }
    }
  }
};

const clampPaging = (page, limit) => ({
  currentPage: Math.max(1, Math.floor(Number(page) || 1)),
  pageLimit: Math.min(100, Math.max(1, Math.floor(Number(limit) || 20))),
});

/* ====================== LIST (party or document view) ====================== */
const getOutstanding = async ({
  tenant,
  kind,
  view = "party",
  partyId,
  search = "",
  asOfDate,
  overdueOnly = false,
  page = 1,
  limit = 20,
}) => {
  const { config, model, match, asOf } = prepare({ tenant, kind, partyId, search, asOfDate });
  const { currentPage, pageLimit } = clampPaging(page, limit);
  const generatedAt = new Date();

  const pipeline = buildBasePipeline({
    config,
    match,
    reference: asOf.reference,
    overdueOnly,
  });

  if (view === "party") {
    pipeline.push(
      {
        $group: {
          _id: "$partyId",
          partyCode: { $first: "$partyCode" },
          partyName: { $first: "$partyName" },
          documentCount: { $sum: 1 },
          oldestDueDate: { $min: "$dueDate" },
          maxOverdueDays: { $max: "$overdueDays" },
          ...sumFields(),
        },
      },
      { $set: { partyId: "$_id", asOfDate: { $literal: asOf.label } } },
      { $sort: { outstandingAmountPaise: -1, _id: 1 } },
    );
  } else {
    pipeline.push({ $sort: { dueDate: 1, documentDate: 1, _id: 1 } });
  }

  // Count comes from the same (already grouped) stream. Totals are NOT computed here.
  pipeline.push({
    $facet: {
      data: [{ $skip: (currentPage - 1) * pageLimit }, { $limit: pageLimit }],
      count: [{ $count: "total" }],
    },
  });

  const [result] = await model.aggregate(pipeline).allowDiskUse(true);

  const total = result?.count?.[0]?.total || 0;
  const data = result?.data || [];
  assertSafe(data);

  return {
    kind,
    view,
    basis: "CURRENT_POSTED_DOCUMENTS",
    currency: "INR",
    timezone: REPORT_TIMEZONE,
    asOfDate: asOf.label,
    generatedAt,
    data,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

/* ====================== SUMMARY (cards) ====================== */
const getOutstandingSummary = async ({
  tenant,
  kind,
  search = "",
  asOfDate,
  overdueOnly = false,
}) => {
  const { config, model, match, asOf } = prepare({ tenant, kind, search, asOfDate });

  const pipeline = [
    ...buildBasePipeline({ config, match, reference: asOf.reference, overdueOnly }),
    {
      $group: {
        _id: "$partyId",
        documentCount: { $sum: 1 },
        ...sumFields(),
      },
    },
    {
      $group: {
        _id: null,
        partyCount: { $sum: 1 },
        documentCount: { $sum: "$documentCount" },
        outstandingAmountPaise: { $sum: "$outstandingAmountPaise" },
        overdueAmountPaise: { $sum: "$overdueAmountPaise" },
        ...Object.fromEntries(BUCKET_KEYS.map((k) => [k, { $sum: `$${k}` }])),
      },
    },
    { $project: { _id: 0 } },
  ];

  const [row] = await model.aggregate(pipeline).allowDiskUse(true);

  const totals = row || {
    partyCount: 0,
    documentCount: 0,
    outstandingAmountPaise: 0,
    overdueAmountPaise: 0,
    ...Object.fromEntries(BUCKET_KEYS.map((k) => [k, 0])),
  };

  assertSafe([totals]);

  return { kind, asOfDate: asOf.label, currency: "INR", totals };
};

module.exports = { getOutstanding, getOutstandingSummary };