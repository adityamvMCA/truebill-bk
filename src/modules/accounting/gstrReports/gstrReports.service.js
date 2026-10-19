const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const SECTIONS = ["B2B", "B2C", "CDNR", "HSN"];
const TAX_HEADS = ["CGST", "SGST", "IGST"];
const EXPORT_CAP = 5000;

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

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const parsePeriod = (fromDate, toDate) => {
  const from = parseDate(fromDate, "fromDate");
  const to = parseDate(toDate, "toDate", true);

  if (from > to) {
    throw createError("fromDate cannot be after toDate");
  }

  return { from, to };
};

const resolveContext = ({ tenant }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("tenantId must be a valid ObjectId");
  }

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "SalesInvoice",
    "SalesReturn",
    "Journal",
    "TaxConfiguration",
  ]) {
    if (!models[name]) {
      throw createError(`Tenant model ${name} is unavailable`, 500);
    }
  }

  return {
    models,
    tenantObjectId: new mongoose.Types.ObjectId(String(tenantId)),
  };
};

const zeroSums = () => ({
  taxablePaise: 0,
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 0,
  totalPaise: 0,
});

const sumItems = (items) => {
  const sums = zeroSums();

  for (const item of items || []) {
    sums.taxablePaise += Number(item.taxableAmountPaise) || 0;
    sums.cgstPaise += Number(item.cgstAmountPaise) || 0;
    sums.sgstPaise += Number(item.sgstAmountPaise) || 0;
    sums.igstPaise += Number(item.igstAmountPaise) || 0;
    sums.totalPaise += Number(item.totalAmountPaise) || 0;
  }

  return sums;
};

const getGstin = (doc) =>
  normalizeText(
    doc?.customerGstin || doc?.customerGstNumber || doc?.gstin,
  ).toUpperCase();

const buildRow = ({ kind, number, date, doc, gstin }) => {
  const sums = sumItems(doc.items);

  return {
    kind,
    documentNumber: number,
    documentDate: date,
    customerCode: doc.customerCode || null,
    customerName: doc.customerName || null,
    gstin: gstin || null,
    ...sums,
    totalTaxPaise: sums.cgstPaise + sums.sgstPaise + sums.igstPaise,
  };
};

const sortRows = (rows) =>
  rows.sort(
    (a, b) =>
      new Date(b.documentDate) - new Date(a.documentDate) ||
      String(b.documentNumber).localeCompare(String(a.documentNumber)),
  );

const addToMap = (map, key, base, sign, item) => {
  const entry = map.get(key) || {
    ...base,
    quantity: 0,
    taxablePaise: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    totalPaise: 0,
  };

  entry.quantity += sign * (Number(item.quantity) || 0);
  entry.taxablePaise += sign * (Number(item.taxableAmountPaise) || 0);
  entry.cgstPaise += sign * (Number(item.cgstAmountPaise) || 0);
  entry.sgstPaise += sign * (Number(item.sgstAmountPaise) || 0);
  entry.igstPaise += sign * (Number(item.igstAmountPaise) || 0);
  entry.totalPaise += sign * (Number(item.totalAmountPaise) || 0);

  map.set(key, entry);
};

const buildReport = async ({ models, tenantObjectId, from, to }) => {
  const [invoices, returns] = await Promise.all([
    models.SalesInvoice.find({
      tenantId: tenantObjectId,
      isDeleted: false,
      status: "POSTED",
      invoiceDate: { $gte: from, $lte: to },
    }).lean(),
    models.SalesReturn.find({
      tenantId: tenantObjectId,
      isDeleted: false,
      status: "POSTED",
      returnDate: { $gte: from, $lte: to },
    }).lean(),
  ]);

  const sourceIds = [
    ...new Set(
      returns
        .map((item) => item.sourceSalesInvoiceId)
        .filter(Boolean)
        .map(String),
    ),
  ];

  const sources = sourceIds.length
    ? await models.SalesInvoice.find({
        tenantId: tenantObjectId,
        _id: { $in: sourceIds },
      }).lean()
    : [];

  const gstinBySourceId = new Map(
    sources.map((source) => [String(source._id), getGstin(source)]),
  );

  const b2b = [];
  const b2c = [];
  const cdnr = [];
  const rateMap = new Map();
  const hsnMap = new Map();

  const addItemTotals = (item, sign) => {
    const gstRate = Number(item.gstRate) || 0;
    const hsnSacCode = normalizeText(item.hsnSacCode) || "NA";
    const unit = normalizeText(item.unit) || "-";

    addToMap(rateMap, String(gstRate), { gstRate }, sign, item);

    addToMap(
      hsnMap,
      `${hsnSacCode}|${unit}|${gstRate}`,
      { hsnSacCode, unit, gstRate },
      sign,
      item,
    );
  };

  for (const invoice of invoices) {
    const gstin = getGstin(invoice);

    const row = buildRow({
      kind: gstin ? "B2B" : "B2C",
      number: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      doc: invoice,
      gstin,
    });

    (gstin ? b2b : b2c).push(row);

    for (const item of invoice.items || []) {
      addItemTotals(item, 1);
    }
  }

  for (const salesReturn of returns) {
    const gstin = gstinBySourceId.get(String(salesReturn.sourceSalesInvoiceId));

    cdnr.push(
      buildRow({
        kind: "CREDIT_NOTE",
        number: salesReturn.returnNumber,
        date: salesReturn.returnDate,
        doc: salesReturn,
        gstin,
      }),
    );

    for (const item of salesReturn.items || []) {
      addItemTotals(item, -1);
    }
  }

  sortRows(b2b);
  sortRows(b2c);
  sortRows(cdnr);

  const net = zeroSums();

  for (const row of [...b2b, ...b2c]) {
    net.taxablePaise += row.taxablePaise;
    net.cgstPaise += row.cgstPaise;
    net.sgstPaise += row.sgstPaise;
    net.igstPaise += row.igstPaise;
    net.totalPaise += row.totalPaise;
  }

  for (const row of cdnr) {
    net.taxablePaise -= row.taxablePaise;
    net.cgstPaise -= row.cgstPaise;
    net.sgstPaise -= row.sgstPaise;
    net.igstPaise -= row.igstPaise;
    net.totalPaise -= row.totalPaise;
  }

  const rateSummary = [...rateMap.values()]
    .map(({ quantity, ...rest }) => ({
      ...rest,
      totalTaxPaise: rest.cgstPaise + rest.sgstPaise + rest.igstPaise,
    }))
    .sort((a, b) => a.gstRate - b.gstRate);

  const hsn = [...hsnMap.values()]
    .map((entry) => ({
      ...entry,
      quantity: Math.round(entry.quantity * 10000) / 10000,
    }))
    .sort(
      (a, b) =>
        a.hsnSacCode.localeCompare(b.hsnSacCode) || a.gstRate - b.gstRate,
    );

  return {
    b2b,
    b2c,
    cdnr,
    hsn,
    rateSummary,
    summary: {
      invoiceCount: b2b.length + b2c.length,
      creditNoteCount: cdnr.length,
      taxablePaise: net.taxablePaise,
      cgstPaise: net.cgstPaise,
      sgstPaise: net.sgstPaise,
      igstPaise: net.igstPaise,
      totalTaxPaise: net.cgstPaise + net.sgstPaise + net.igstPaise,
      invoiceValuePaise: net.totalPaise,
    },
  };
};

const getLedgerTotals = async ({
  models,
  tenantObjectId,
  configuration,
  from,
  to,
}) => {
  const ids = [];

  for (const head of TAX_HEADS) {
    ids.push(configuration[OUTPUT_LEDGER_FIELDS[head]]);
    ids.push(configuration[INPUT_LEDGER_FIELDS[head]]);
  }

  const ledgerIds = ids
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (!ledgerIds.length) return new Map();

  const rows = await models.Journal.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        postingDate: { $gte: from, $lte: to },
      },
    },
    { $unwind: "$lines" },
    { $match: { "lines.ledgerId": { $in: ledgerIds } } },
    {
      $group: {
        _id: "$lines.ledgerId",
        debitPaise: { $sum: "$lines.debitPaise" },
        creditPaise: { $sum: "$lines.creditPaise" },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row]));
};

const getGstr1 = async ({
  tenant,
  fromDate,
  toDate,
  section,
  search,
  page = 1,
  limit = 10,
  exportAll,
}) => {
  const { models, tenantObjectId } = resolveContext({ tenant });
  const { from, to } = parsePeriod(fromDate, toDate);

  const normalizedSection = normalizeText(section || "B2B").toUpperCase();

  if (!SECTIONS.includes(normalizedSection)) {
    throw createError("Unsupported GSTR-1 section");
  }

  const currentPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 10, 1),
    100,
  );

  const report = await buildReport({ models, tenantObjectId, from, to });

  const sectionRows = {
    B2B: report.b2b,
    B2C: report.b2c,
    CDNR: report.cdnr,
    HSN: report.hsn,
  }[normalizedSection];

  const term = normalizeText(search).toLowerCase();

  const fields =
    normalizedSection === "HSN"
      ? ["hsnSacCode", "unit"]
      : ["documentNumber", "customerName", "customerCode", "gstin"];

  const filtered = term
    ? sectionRows.filter((row) =>
        fields.some((field) =>
          String(row[field] ?? "")
            .toLowerCase()
            .includes(term),
        ),
      )
    : sectionRows;

  const isExport = String(exportAll) === "true";
  const total = filtered.length;

  const rows = isExport
    ? filtered.slice(0, EXPORT_CAP)
    : filtered.slice((currentPage - 1) * pageLimit, currentPage * pageLimit);

  return {
    period: { fromDate: normalizeText(fromDate), toDate: normalizeText(toDate) },
    summary: report.summary,
    rateSummary: report.rateSummary,
    sectionCounts: {
      B2B: report.b2b.length,
      B2C: report.b2c.length,
      CDNR: report.cdnr.length,
      HSN: report.hsn.length,
    },
    section: normalizedSection,
    rows,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getGstr3b = async ({ tenant, fromDate, toDate }) => {
  const { models, tenantObjectId } = resolveContext({ tenant });
  const { from, to } = parsePeriod(fromDate, toDate);

  const [report, configuration] = await Promise.all([
    buildReport({ models, tenantObjectId, from, to }),
    models.TaxConfiguration.findOne({ tenantId: tenantObjectId }).lean(),
  ]);

  const ledgerTotals = configuration
    ? await getLedgerTotals({
        models,
        tenantObjectId,
        configuration,
        from,
        to,
      })
    : new Map();

  const zero = { debitPaise: 0, creditPaise: 0 };

  const outward = {
    taxablePaise: report.summary.taxablePaise,
    cgstPaise: report.summary.cgstPaise,
    sgstPaise: report.summary.sgstPaise,
    igstPaise: report.summary.igstPaise,
  };

  const itc = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
  const payable = [];
  const reconciliation = [];

  for (const head of TAX_HEADS) {
    const key = HEAD_KEYS[head];

    const outputId = configuration?.[OUTPUT_LEDGER_FIELDS[head]];
    const inputId = configuration?.[INPUT_LEDGER_FIELDS[head]];

    const outputLedger = (outputId && ledgerTotals.get(String(outputId))) || zero;
    const inputLedger = (inputId && ledgerTotals.get(String(inputId))) || zero;

    const documentPaise = report.summary[key];
    const ledgerPaise = outputLedger.creditPaise - outputLedger.debitPaise;
    const itcPaise = inputLedger.debitPaise - inputLedger.creditPaise;

    itc[key] = itcPaise;
    itc.totalPaise += itcPaise;

    payable.push({
      taxHead: head,
      outputPaise: documentPaise,
      itcPaise,
      netPaise: documentPaise - itcPaise,
    });

    reconciliation.push({
      taxHead: head,
      documentPaise,
      ledgerPaise,
      differencePaise: documentPaise - ledgerPaise,
      mapped: Boolean(outputId),
    });
  }

  const totals = payable.reduce(
    (sum, row) => ({
      outputPaise: sum.outputPaise + row.outputPaise,
      itcPaise: sum.itcPaise + row.itcPaise,
      netPaise: sum.netPaise + row.netPaise,
    }),
    { outputPaise: 0, itcPaise: 0, netPaise: 0 },
  );

  return {
    configured: Boolean(configuration),
    period: { fromDate: normalizeText(fromDate), toDate: normalizeText(toDate) },
    outward,
    itc,
    payable,
    totals,
    reconciliation,
  };
};

module.exports = { getGstr1, getGstr3b };