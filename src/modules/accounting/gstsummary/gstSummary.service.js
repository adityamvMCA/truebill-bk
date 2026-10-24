const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const TAX_HEADS = ["CGST", "SGST", "IGST"];

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

const SOURCE_TYPES = [
  "PURCHASE_BILL",
  "SUPPLIER_PAYMENT",
  "MANUAL_JOURNAL",
  "SALES_INVOICE",
  "CUSTOMER_RECEIPT",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

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

const resolveContext = ({ tenant }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("tenantId must be a valid ObjectId");
  }

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["Journal", "TaxConfiguration"]) {
    if (!models[name]) {
      throw createError(`Tenant model ${name} is unavailable`, 500);
    }
  }

  return {
    models,
    tenantObjectId: new mongoose.Types.ObjectId(String(tenantId)),
  };
};

const emptySummary = () =>
  TAX_HEADS.map((taxHead) => ({
    taxHead,
    outputCollectedPaise: 0,
    outputReversedPaise: 0,
    outputPaise: 0,
    inputClaimedPaise: 0,
    inputReversedPaise: 0,
    inputPaise: 0,
    netPaise: 0,
    mapped: { output: false, input: false },
  }));

const getGstSummary = async ({
  tenant,
  fromDate,
  toDate,
  sourceType,
  search,
  page = 1,
  limit = 10,
}) => {
  const { models, tenantObjectId } = resolveContext({ tenant });

  const from = parseDate(fromDate, "fromDate");
  const to = parseDate(toDate, "toDate", true);

  if (from > to) {
    throw createError("fromDate cannot be after toDate");
  }

  const normalizedSourceType = normalizeText(sourceType).toUpperCase();

  if (normalizedSourceType && !SOURCE_TYPES.includes(normalizedSourceType)) {
    throw createError("Unsupported source type");
  }

  const currentPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 10, 1),
    100,
  );

  const emptyResult = (configured) => ({
    configured,
    period: {
      fromDate: normalizeText(fromDate),
      toDate: normalizeText(toDate),
    },
    summary: emptySummary(),
    totals: { outputPaise: 0, inputPaise: 0, netPaise: 0 },
    rows: [],
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total: 0,
      totalPages: 0,
    },
  });

  const configuration = await models.TaxConfiguration.findOne({
    tenantId: tenantObjectId,
  }).lean();

  if (!configuration) {
    return emptyResult(false);
  }

  const metaById = new Map();

  for (const taxHead of TAX_HEADS) {
    const outputId = configuration[OUTPUT_LEDGER_FIELDS[taxHead]];
    const inputId = configuration[INPUT_LEDGER_FIELDS[taxHead]];

    if (outputId) metaById.set(String(outputId), { taxHead, side: "OUTPUT" });
    if (inputId) metaById.set(String(inputId), { taxHead, side: "INPUT" });
  }

  if (!metaById.size) {
    return emptyResult(false);
  }

  const ledgerObjectIds = [...metaById.keys()].map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const baseMatch = {
    tenantId: tenantObjectId,
    postingDate: { $gte: from, $lte: to },
  };

  const totalRows = await models.Journal.aggregate([
    { $match: baseMatch },
    { $unwind: "$lines" },
    { $match: { "lines.ledgerId": { $in: ledgerObjectIds } } },
    {
      $group: {
        _id: "$lines.ledgerId",
        debitPaise: { $sum: "$lines.debitPaise" },
        creditPaise: { $sum: "$lines.creditPaise" },
      },
    },
  ]);

  const byLedger = new Map(totalRows.map((row) => [String(row._id), row]));

  const zero = { debitPaise: 0, creditPaise: 0 };

  const summary = TAX_HEADS.map((taxHead) => {
    const outputId = configuration[OUTPUT_LEDGER_FIELDS[taxHead]];
    const inputId = configuration[INPUT_LEDGER_FIELDS[taxHead]];

    const output = (outputId && byLedger.get(String(outputId))) || zero;
    const input = (inputId && byLedger.get(String(inputId))) || zero;

    const outputPaise = output.creditPaise - output.debitPaise;
    const inputPaise = input.debitPaise - input.creditPaise;

    return {
      taxHead,
      outputCollectedPaise: output.creditPaise,
      outputReversedPaise: output.debitPaise,
      outputPaise,
      inputClaimedPaise: input.debitPaise,
      inputReversedPaise: input.creditPaise,
      inputPaise,
      netPaise: outputPaise - inputPaise,
      mapped: { output: Boolean(outputId), input: Boolean(inputId) },
    };
  });

  const totals = summary.reduce(
    (sum, row) => ({
      outputPaise: sum.outputPaise + row.outputPaise,
      inputPaise: sum.inputPaise + row.inputPaise,
      netPaise: sum.netPaise + row.netPaise,
    }),
    { outputPaise: 0, inputPaise: 0, netPaise: 0 },
  );

  const rowMatch = { ...baseMatch };

  if (normalizedSourceType) {
    rowMatch.sourceType = normalizedSourceType;
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    rowMatch.$or = [
      { sourceNumber: { $regex: escaped, $options: "i" } },
      { journalNumber: { $regex: escaped, $options: "i" } },
      { narration: { $regex: escaped, $options: "i" } },
    ];
  }

  const [facet] = await models.Journal.aggregate([
    { $match: rowMatch },
    { $match: { "lines.ledgerId": { $in: ledgerObjectIds } } },
    {
      $project: {
        journalNumber: 1,
        postingDate: 1,
        sourceType: 1,
        sourceNumber: 1,
        narration: 1,
        lines: {
          $filter: {
            input: "$lines",
            as: "line",
            cond: { $in: ["$$line.ledgerId", ledgerObjectIds] },
          },
        },
      },
    },
    { $sort: { postingDate: -1, _id: -1 } },
    {
      $facet: {
        data: [{ $skip: (currentPage - 1) * pageLimit }, { $limit: pageLimit }],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = facet?.total?.[0]?.count || 0;

  const rows = (facet?.data || []).map((journal) => {
    const heads = { CGST: 0, SGST: 0, IGST: 0 };
    const sides = new Set();

    for (const line of journal.lines || []) {
      const meta = metaById.get(String(line.ledgerId));

      if (!meta) continue;

      heads[meta.taxHead] += (line.creditPaise || 0) - (line.debitPaise || 0);
      sides.add(meta.side);
    }

    return {
      journalId: journal._id,
      journalNumber: journal.journalNumber,
      postingDate: journal.postingDate,
      sourceType: journal.sourceType,
      sourceNumber: journal.sourceNumber,
      narration: journal.narration || null,
      side: sides.size > 1 ? "MIXED" : [...sides][0] || "OUTPUT",
      cgstPaise: heads.CGST,
      sgstPaise: heads.SGST,
      igstPaise: heads.IGST,
      netPaise: heads.CGST + heads.SGST + heads.IGST,
    };
  });

  return {
    configured: true,
    period: {
      fromDate: normalizeText(fromDate),
      toDate: normalizeText(toDate),
    },
    summary,
    totals,
    rows,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

module.exports = { getGstSummary };
