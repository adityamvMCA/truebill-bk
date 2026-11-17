// const mongoose = require("mongoose");

// const {
//   getTenantAccountingModels,
// } = require("../../../tenancy/tenantAccountingModels");

// const {
//   getReadyTenantConnection,
// } = require("../../../tenancy/tenantConnectionManager");

// const SECTIONS = ["B2B", "B2C", "CDNR", "HSN"];
// const TAX_HEADS = ["CGST", "SGST", "IGST"];
// const EXPORT_CAP = 5000;

// const HEAD_KEYS = {
//   CGST: "cgstPaise",
//   SGST: "sgstPaise",
//   IGST: "igstPaise",
// };

// const OUTPUT_LEDGER_FIELDS = {
//   CGST: "outputCgstLedgerId",
//   SGST: "outputSgstLedgerId",
//   IGST: "outputIgstLedgerId",
// };

// const INPUT_LEDGER_FIELDS = {
//   CGST: "inputCgstLedgerId",
//   SGST: "inputSgstLedgerId",
//   IGST: "inputIgstLedgerId",
// };

// const createError = (message, statusCode = 400) => {
//   const error = new Error(message);
//   error.statusCode = statusCode;
//   return error;
// };

// const normalizeText = (value) => String(value ?? "").trim();

// const parseDate = (value, fieldName, endOfDay = false) => {
//   const text = normalizeText(value);

//   if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
//     throw createError(`${fieldName} must be a valid date (YYYY-MM-DD)`);
//   }

//   const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
//   const date = new Date(`${text}T${time}Z`);

//   if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
//     throw createError(`${fieldName} is invalid`);
//   }

//   return date;
// };

// const parsePeriod = (fromDate, toDate) => {
//   const from = parseDate(fromDate, "fromDate");
//   const to = parseDate(toDate, "toDate", true);

//   if (from > to) {
//     throw createError("fromDate cannot be after toDate");
//   }

//   return { from, to };
// };

// const resolveContext = ({ tenant }) => {
//   const tenantId = tenant?._id ?? tenant?.id;

//   if (!mongoose.isObjectIdOrHexString(tenantId)) {
//     throw createError("tenantId must be a valid ObjectId");
//   }

//   const connection = getReadyTenantConnection(tenant);
//   const models = getTenantAccountingModels(connection);

//   for (const name of [
//     "SalesInvoice",
//     "SalesReturn",
//     "Journal",
//     "TaxConfiguration",
//   ]) {
//     if (!models[name]) {
//       throw createError(`Tenant model ${name} is unavailable`, 500);
//     }
//   }

//   return {
//     models,
//     tenantObjectId: new mongoose.Types.ObjectId(String(tenantId)),
//   };
// };

// const zeroSums = () => ({
//   taxablePaise: 0,
//   cgstPaise: 0,
//   sgstPaise: 0,
//   igstPaise: 0,
//   totalPaise: 0,
// });

// const sumItems = (items) => {
//   const sums = zeroSums();

//   for (const item of items || []) {
//     sums.taxablePaise += Number(item.taxableAmountPaise) || 0;
//     sums.cgstPaise += Number(item.cgstAmountPaise) || 0;
//     sums.sgstPaise += Number(item.sgstAmountPaise) || 0;
//     sums.igstPaise += Number(item.igstAmountPaise) || 0;
//     sums.totalPaise += Number(item.totalAmountPaise) || 0;
//   }

//   return sums;
// };

// const getGstin = (doc) =>
//   normalizeText(
//     doc?.customerGstin || doc?.customerGstNumber || doc?.gstin,
//   ).toUpperCase();

// const buildRow = ({ kind, number, date, doc, gstin }) => {
//   const sums = sumItems(doc.items);

//   return {
//     kind,
//     documentNumber: number,
//     documentDate: date,
//     customerCode: doc.customerCode || null,
//     customerName: doc.customerName || null,
//     gstin: gstin || null,
//     ...sums,
//     totalTaxPaise: sums.cgstPaise + sums.sgstPaise + sums.igstPaise,
//   };
// };

// const sortRows = (rows) =>
//   rows.sort(
//     (a, b) =>
//       new Date(b.documentDate) - new Date(a.documentDate) ||
//       String(b.documentNumber).localeCompare(String(a.documentNumber)),
//   );

// const addToMap = (map, key, base, sign, item) => {
//   const entry = map.get(key) || {
//     ...base,
//     quantity: 0,
//     taxablePaise: 0,
//     cgstPaise: 0,
//     sgstPaise: 0,
//     igstPaise: 0,
//     totalPaise: 0,
//   };

//   entry.quantity += sign * (Number(item.quantity) || 0);
//   entry.taxablePaise += sign * (Number(item.taxableAmountPaise) || 0);
//   entry.cgstPaise += sign * (Number(item.cgstAmountPaise) || 0);
//   entry.sgstPaise += sign * (Number(item.sgstAmountPaise) || 0);
//   entry.igstPaise += sign * (Number(item.igstAmountPaise) || 0);
//   entry.totalPaise += sign * (Number(item.totalAmountPaise) || 0);

//   map.set(key, entry);
// };

// const buildReport = async ({ models, tenantObjectId, from, to }) => {
//   const [invoices, returns] = await Promise.all([
//     models.SalesInvoice.find({
//       tenantId: tenantObjectId,
//       isDeleted: false,
//       status: "POSTED",
//       invoiceDate: { $gte: from, $lte: to },
//     }).lean(),
//     models.SalesReturn.find({
//       tenantId: tenantObjectId,
//       isDeleted: false,
//       status: "POSTED",
//       returnDate: { $gte: from, $lte: to },
//     }).lean(),
//   ]);

//   const sourceIds = [
//     ...new Set(
//       returns
//         .map((item) => item.sourceSalesInvoiceId)
//         .filter(Boolean)
//         .map(String),
//     ),
//   ];

//   const sources = sourceIds.length
//     ? await models.SalesInvoice.find({
//         tenantId: tenantObjectId,
//         _id: { $in: sourceIds },
//       }).lean()
//     : [];

//   const gstinBySourceId = new Map(
//     sources.map((source) => [String(source._id), getGstin(source)]),
//   );

//   const b2b = [];
//   const b2c = [];
//   const cdnr = [];
//   const rateMap = new Map();
//   const hsnMap = new Map();

//   const addItemTotals = (item, sign) => {
//     const gstRate = Number(item.gstRate) || 0;
//     const hsnSacCode = normalizeText(item.hsnSacCode) || "NA";
//     const unit = normalizeText(item.unit) || "-";

//     addToMap(rateMap, String(gstRate), { gstRate }, sign, item);

//     addToMap(
//       hsnMap,
//       `${hsnSacCode}|${unit}|${gstRate}`,
//       { hsnSacCode, unit, gstRate },
//       sign,
//       item,
//     );
//   };

//   for (const invoice of invoices) {
//     const gstin = getGstin(invoice);

//     const row = buildRow({
//       kind: gstin ? "B2B" : "B2C",
//       number: invoice.invoiceNumber,
//       date: invoice.invoiceDate,
//       doc: invoice,
//       gstin,
//     });

//     (gstin ? b2b : b2c).push(row);

//     for (const item of invoice.items || []) {
//       addItemTotals(item, 1);
//     }
//   }

//   for (const salesReturn of returns) {
//     const gstin = gstinBySourceId.get(String(salesReturn.sourceSalesInvoiceId));

//     cdnr.push(
//       buildRow({
//         kind: "CREDIT_NOTE",
//         number: salesReturn.returnNumber,
//         date: salesReturn.returnDate,
//         doc: salesReturn,
//         gstin,
//       }),
//     );

//     for (const item of salesReturn.items || []) {
//       addItemTotals(item, -1);
//     }
//   }

//   sortRows(b2b);
//   sortRows(b2c);
//   sortRows(cdnr);

//   const net = zeroSums();

//   for (const row of [...b2b, ...b2c]) {
//     net.taxablePaise += row.taxablePaise;
//     net.cgstPaise += row.cgstPaise;
//     net.sgstPaise += row.sgstPaise;
//     net.igstPaise += row.igstPaise;
//     net.totalPaise += row.totalPaise;
//   }

//   for (const row of cdnr) {
//     net.taxablePaise -= row.taxablePaise;
//     net.cgstPaise -= row.cgstPaise;
//     net.sgstPaise -= row.sgstPaise;
//     net.igstPaise -= row.igstPaise;
//     net.totalPaise -= row.totalPaise;
//   }

//   const rateSummary = [...rateMap.values()]
//     .map(({ quantity, ...rest }) => ({
//       ...rest,
//       totalTaxPaise: rest.cgstPaise + rest.sgstPaise + rest.igstPaise,
//     }))
//     .sort((a, b) => a.gstRate - b.gstRate);

//   const hsn = [...hsnMap.values()]
//     .map((entry) => ({
//       ...entry,
//       quantity: Math.round(entry.quantity * 10000) / 10000,
//     }))
//     .sort(
//       (a, b) =>
//         a.hsnSacCode.localeCompare(b.hsnSacCode) || a.gstRate - b.gstRate,
//     );

//   return {
//     b2b,
//     b2c,
//     cdnr,
//     hsn,
//     rateSummary,
//     summary: {
//       invoiceCount: b2b.length + b2c.length,
//       creditNoteCount: cdnr.length,
//       taxablePaise: net.taxablePaise,
//       cgstPaise: net.cgstPaise,
//       sgstPaise: net.sgstPaise,
//       igstPaise: net.igstPaise,
//       totalTaxPaise: net.cgstPaise + net.sgstPaise + net.igstPaise,
//       invoiceValuePaise: net.totalPaise,
//     },
//   };
// };

// const getLedgerTotals = async ({
//   models,
//   tenantObjectId,
//   configuration,
//   from,
//   to,
// }) => {
//   const ids = [];

//   for (const head of TAX_HEADS) {
//     ids.push(configuration[OUTPUT_LEDGER_FIELDS[head]]);
//     ids.push(configuration[INPUT_LEDGER_FIELDS[head]]);
//   }

//   const ledgerIds = ids
//     .filter(Boolean)
//     .map((id) => new mongoose.Types.ObjectId(String(id)));

//   if (!ledgerIds.length) return new Map();

//   const rows = await models.Journal.aggregate([
//     {
//       $match: {
//         tenantId: tenantObjectId,
//         postingDate: { $gte: from, $lte: to },
//       },
//     },
//     { $unwind: "$lines" },
//     { $match: { "lines.ledgerId": { $in: ledgerIds } } },
//     {
//       $group: {
//         _id: "$lines.ledgerId",
//         debitPaise: { $sum: "$lines.debitPaise" },
//         creditPaise: { $sum: "$lines.creditPaise" },
//       },
//     },
//   ]);

//   return new Map(rows.map((row) => [String(row._id), row]));
// };

// const getGstr1 = async ({
//   tenant,
//   fromDate,
//   toDate,
//   section,
//   search,
//   page = 1,
//   limit = 10,
//   exportAll,
// }) => {
//   const { models, tenantObjectId } = resolveContext({ tenant });
//   const { from, to } = parsePeriod(fromDate, toDate);

//   const normalizedSection = normalizeText(section || "B2B").toUpperCase();

//   if (!SECTIONS.includes(normalizedSection)) {
//     throw createError("Unsupported GSTR-1 section");
//   }

//   const currentPage = Math.max(Number.parseInt(page, 10) || 1, 1);
//   const pageLimit = Math.min(
//     Math.max(Number.parseInt(limit, 10) || 10, 1),
//     100,
//   );

//   const report = await buildReport({ models, tenantObjectId, from, to });

//   const sectionRows = {
//     B2B: report.b2b,
//     B2C: report.b2c,
//     CDNR: report.cdnr,
//     HSN: report.hsn,
//   }[normalizedSection];

//   const term = normalizeText(search).toLowerCase();

//   const fields =
//     normalizedSection === "HSN"
//       ? ["hsnSacCode", "unit"]
//       : ["documentNumber", "customerName", "customerCode", "gstin"];

//   const filtered = term
//     ? sectionRows.filter((row) =>
//         fields.some((field) =>
//           String(row[field] ?? "")
//             .toLowerCase()
//             .includes(term),
//         ),
//       )
//     : sectionRows;

//   const isExport = String(exportAll) === "true";
//   const total = filtered.length;

//   const rows = isExport
//     ? filtered.slice(0, EXPORT_CAP)
//     : filtered.slice((currentPage - 1) * pageLimit, currentPage * pageLimit);

//   return {
//     period: { fromDate: normalizeText(fromDate), toDate: normalizeText(toDate) },
//     summary: report.summary,
//     rateSummary: report.rateSummary,
//     sectionCounts: {
//       B2B: report.b2b.length,
//       B2C: report.b2c.length,
//       CDNR: report.cdnr.length,
//       HSN: report.hsn.length,
//     },
//     section: normalizedSection,
//     rows,
//     pagination: {
//       page: currentPage,
//       limit: pageLimit,
//       total,
//       totalPages: Math.ceil(total / pageLimit),
//     },
//   };
// };

// const getGstr3b = async ({ tenant, fromDate, toDate }) => {
//   const { models, tenantObjectId } = resolveContext({ tenant });
//   const { from, to } = parsePeriod(fromDate, toDate);

//   const [report, configuration] = await Promise.all([
//     buildReport({ models, tenantObjectId, from, to }),
//     models.TaxConfiguration.findOne({ tenantId: tenantObjectId }).lean(),
//   ]);

//   const ledgerTotals = configuration
//     ? await getLedgerTotals({
//         models,
//         tenantObjectId,
//         configuration,
//         from,
//         to,
//       })
//     : new Map();

//   const zero = { debitPaise: 0, creditPaise: 0 };

//   const outward = {
//     taxablePaise: report.summary.taxablePaise,
//     cgstPaise: report.summary.cgstPaise,
//     sgstPaise: report.summary.sgstPaise,
//     igstPaise: report.summary.igstPaise,
//   };

//   const itc = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
//   const payable = [];
//   const reconciliation = [];

//   for (const head of TAX_HEADS) {
//     const key = HEAD_KEYS[head];

//     const outputId = configuration?.[OUTPUT_LEDGER_FIELDS[head]];
//     const inputId = configuration?.[INPUT_LEDGER_FIELDS[head]];

//     const outputLedger = (outputId && ledgerTotals.get(String(outputId))) || zero;
//     const inputLedger = (inputId && ledgerTotals.get(String(inputId))) || zero;

//     const documentPaise = report.summary[key];
//     const ledgerPaise = outputLedger.creditPaise - outputLedger.debitPaise;
//     const itcPaise = inputLedger.debitPaise - inputLedger.creditPaise;

//     itc[key] = itcPaise;
//     itc.totalPaise += itcPaise;

//     payable.push({
//       taxHead: head,
//       outputPaise: documentPaise,
//       itcPaise,
//       netPaise: documentPaise - itcPaise,
//     });

//     reconciliation.push({
//       taxHead: head,
//       documentPaise,
//       ledgerPaise,
//       differencePaise: documentPaise - ledgerPaise,
//       mapped: Boolean(outputId),
//     });
//   }

//   const totals = payable.reduce(
//     (sum, row) => ({
//       outputPaise: sum.outputPaise + row.outputPaise,
//       itcPaise: sum.itcPaise + row.itcPaise,
//       netPaise: sum.netPaise + row.netPaise,
//     }),
//     { outputPaise: 0, itcPaise: 0, netPaise: 0 },
//   );

//   return {
//     configured: Boolean(configuration),
//     period: { fromDate: normalizeText(fromDate), toDate: normalizeText(toDate) },
//     outward,
//     itc,
//     payable,
//     totals,
//     reconciliation,
//   };
// };

// module.exports = { getGstr1, getGstr3b };

const mongoose = require("mongoose");

const {
  TAX_HEADS,
  HEAD_KEYS,
  OUTPUT_LEDGER_FIELDS,
  INPUT_LEDGER_FIELDS,
  JOURNAL_ACTIVE_FILTER,
  MAX_RANGE_DAYS,
  createError,
  normalizeText,
  parsePeriod,
  parsePaging,
  resolveContext,
} = require("../../../utils/gstUtils");

const SECTIONS = ["B2B", "B2CL", "B2CS", "CDNR", "CDNUR", "HSN"];
const EXPORT_CAP = 5000;

// B2CL threshold: inter-state invoice to an unregistered buyer above Rs 1 lakh
// (lowered from Rs 2.5 lakh from Aug 2024). Verify against the current notification.
const B2CL_LIMIT_PAISE = 10000000;

const INVOICE_FIELDS = [
  "invoiceNumber",
  "invoiceDate",
  "customerCode",
  "customerName",
  "customerGstin",
  "customerGstNumber",
  "gstin",
  "placeOfSupply",
  "placeOfSupplyCode",
  "shippingState",
  "billingState",
  "customerState",
  "reverseCharge",
  "invoiceType",
  "supplyType",
  "isExport",
  "grandTotalPaise",
  "items",
].join(" ");

const RETURN_FIELDS = [
  "returnNumber",
  "returnDate",
  "sourceSalesInvoiceId",
  ...INVOICE_FIELDS.split(" ").filter((field) => field !== "invoiceNumber"),
].join(" ");

/* ----------------------------- small helpers ----------------------------- */

const zeroSums = () => ({
  taxablePaise: 0,
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 0,
  cessPaise: 0,
  totalPaise: 0,
});

const num = (value) => Number(value) || 0;

const addSums = (target, item, sign = 1) => {
  target.taxablePaise += sign * num(item.taxableAmountPaise);
  target.cgstPaise += sign * num(item.cgstAmountPaise);
  target.sgstPaise += sign * num(item.sgstAmountPaise);
  target.igstPaise += sign * num(item.igstAmountPaise);
  target.cessPaise += sign * num(item.cessAmountPaise);
  target.totalPaise += sign * num(item.totalAmountPaise);
};

const sumItems = (items) => {
  const sums = zeroSums();

  for (const item of items || []) addSums(sums, item);

  return sums;
};

const getGstin = (doc) =>
  normalizeText(
    doc?.customerGstin || doc?.customerGstNumber || doc?.gstin,
  ).toUpperCase();

const getPlace = (doc) =>
  normalizeText(
    doc?.placeOfSupplyCode ||
      doc?.placeOfSupply ||
      doc?.shippingState ||
      doc?.billingState ||
      doc?.customerState,
  ) || "NA";

const classifyItem = (item, doc) => {
  const type = normalizeText(item.supplyType || doc.supplyType).toUpperCase();

  if (doc.isExport || ["EXPORT", "SEZ", "ZERO_RATED"].includes(type)) {
    return "ZERO_RATED";
  }

  if (type === "EXEMPT") return "EXEMPT";
  if (type === "NON_GST") return "NON_GST";
  if (type === "NIL" || num(item.gstRate) === 0) return "NIL";

  return "TAXABLE";
};

// Invoice value uses the document grand total (round-off, freight and
// invoice-level discounts included) and falls back to the item total.
const describeDoc = (doc, gstin) => {
  const sums = sumItems(doc.items);
  const grand = Number(doc.grandTotalPaise);
  const value = Number.isFinite(grand) && grand > 0 ? grand : sums.totalPaise;

  return {
    sums,
    value,
    gstin,
    place: getPlace(doc),
    interState: sums.igstPaise > 0,
  };
};

const classifyInvoice = (doc) => {
  const gstin = getGstin(doc);
  const info = describeDoc(doc, gstin);

  let kind = "B2CS";

  if (gstin) kind = "B2B";
  else if (info.interState && info.value > B2CL_LIMIT_PAISE) kind = "B2CL";

  return { gstin, info, kind };
};

const groupRateLines = (items) => {
  const map = new Map();

  for (const item of items || []) {
    const gstRate = num(item.gstRate);
    const entry = map.get(gstRate) || { gstRate, ...zeroSums() };

    addSums(entry, item);
    map.set(gstRate, entry);
  }

  return [...map.values()].sort((a, b) => a.gstRate - b.gstRate);
};

const buildRow = ({ kind, number, date, doc, info }) => ({
  kind,
  documentNumber: number,
  documentDate: date,
  customerCode: doc.customerCode || null,
  customerName: doc.customerName || null,
  gstin: info.gstin || null,
  placeOfSupply: info.place,
  reverseCharge: Boolean(doc.reverseCharge),
  invoiceType: doc.invoiceType || "Regular",
  ...info.sums,
  totalPaise: info.value,
  totalTaxPaise: info.sums.cgstPaise + info.sums.sgstPaise + info.sums.igstPaise,
  rateLines: groupRateLines(doc.items),
});

const sortRows = (rows) =>
  rows.sort(
    (a, b) =>
      new Date(b.documentDate) - new Date(a.documentDate) ||
      String(b.documentNumber).localeCompare(String(a.documentNumber)),
  );

const addToMap = (map, key, base, sign, item) => {
  const entry = map.get(key) || { ...base, quantity: 0, ...zeroSums() };

  entry.quantity += sign * num(item.quantity);
  addSums(entry, item, sign);

  map.set(key, entry);
};

/* -------------------------------- report -------------------------------- */

const buildReport = async ({ models, tenantObjectId, from, to }) => {
  const [invoices, returns] = await Promise.all([
    models.SalesInvoice.find({
      tenantId: tenantObjectId,
      isDeleted: false,
      status: "POSTED",
      invoiceDate: { $gte: from, $lte: to },
    })
      .select(INVOICE_FIELDS)
      .lean(),
    models.SalesReturn.find({
      tenantId: tenantObjectId,
      isDeleted: false,
      status: "POSTED",
      returnDate: { $gte: from, $lte: to },
    })
      .select(RETURN_FIELDS)
      .lean(),
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
      })
        .select(INVOICE_FIELDS)
        .lean()
    : [];

  const sourceById = new Map(
    sources.map((source) => [String(source._id), classifyInvoice(source)]),
  );

  const b2b = [];
  const b2cl = [];
  const cdnr = [];
  const cdnur = [];

  const b2csMap = new Map();
  const rateMap = new Map();
  const hsnMap = new Map();
  const interStateMap = new Map();

  const net = zeroSums();

  const outward = {
    taxable: zeroSums(),
    zeroRated: zeroSums(),
    nil: zeroSums(),
    exempt: zeroSums(),
    nonGst: zeroSums(),
  };

  const OUTWARD_BUCKET = {
    TAXABLE: "taxable",
    ZERO_RATED: "zeroRated",
    NIL: "nil",
    EXEMPT: "exempt",
    NON_GST: "nonGst",
  };

  const addItemTotals = (item, sign, doc, info, toB2cs) => {
    const gstRate = num(item.gstRate);
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

    addSums(outward[OUTWARD_BUCKET[classifyItem(item, doc)]], item, sign);

    if (toB2cs) {
      addToMap(
        b2csMap,
        `${info.place}|${gstRate}`,
        { kind: "B2CS", placeOfSupply: info.place, gstRate },
        sign,
        item,
      );
    }

    // GSTR-3B 3.2: inter-state supplies to unregistered persons
    if (!info.gstin && num(item.igstAmountPaise) > 0) {
      const entry = interStateMap.get(info.place) || {
        placeOfSupply: info.place,
        taxablePaise: 0,
        igstPaise: 0,
      };

      entry.taxablePaise += sign * num(item.taxableAmountPaise);
      entry.igstPaise += sign * num(item.igstAmountPaise);
      interStateMap.set(info.place, entry);
    }
  };

  const applyNet = (info, sign) => {
    net.taxablePaise += sign * info.sums.taxablePaise;
    net.cgstPaise += sign * info.sums.cgstPaise;
    net.sgstPaise += sign * info.sums.sgstPaise;
    net.igstPaise += sign * info.sums.igstPaise;
    net.cessPaise += sign * info.sums.cessPaise;
    net.totalPaise += sign * info.value;
  };

  for (const invoice of invoices) {
    const { info, kind } = classifyInvoice(invoice);

    if (kind !== "B2CS") {
      const row = buildRow({
        kind,
        number: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        doc: invoice,
        info,
      });

      (kind === "B2B" ? b2b : b2cl).push(row);
    }

    for (const item of invoice.items || []) {
      addItemTotals(item, 1, invoice, info, kind === "B2CS");
    }

    applyNet(info, 1);
  }

  for (const salesReturn of returns) {
    const source = sourceById.get(String(salesReturn.sourceSalesInvoiceId));
    const gstin = source?.gstin || getGstin(salesReturn);
    const info = describeDoc(salesReturn, gstin);

    // Registered buyer -> CDNR. Unregistered buyer on a B2CL invoice -> CDNUR.
    // Any other unregistered return adjusts the B2CS aggregate.
    let toB2cs = false;

    if (gstin) {
      cdnr.push(
        buildRow({
          kind: "CREDIT_NOTE",
          number: salesReturn.returnNumber,
          date: salesReturn.returnDate,
          doc: salesReturn,
          info,
        }),
      );
    } else if (source?.kind === "B2CL") {
      cdnur.push(
        buildRow({
          kind: "CREDIT_NOTE_UR",
          number: salesReturn.returnNumber,
          date: salesReturn.returnDate,
          doc: salesReturn,
          info,
        }),
      );
    } else {
      toB2cs = true;
    }

    for (const item of salesReturn.items || []) {
      addItemTotals(item, -1, salesReturn, info, toB2cs);
    }

    applyNet(info, -1);
  }

  sortRows(b2b);
  sortRows(b2cl);
  sortRows(cdnr);
  sortRows(cdnur);

  const b2cs = [...b2csMap.values()]
    .map(({ quantity, ...rest }) => ({
      ...rest,
      totalTaxPaise: rest.cgstPaise + rest.sgstPaise + rest.igstPaise,
    }))
    .sort(
      (a, b) =>
        a.placeOfSupply.localeCompare(b.placeOfSupply) ||
        a.gstRate - b.gstRate,
    );

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
    b2cl,
    b2cs,
    cdnr,
    cdnur,
    hsn,
    rateSummary,
    outward,
    interStateUnregistered: [...interStateMap.values()].sort((a, b) =>
      a.placeOfSupply.localeCompare(b.placeOfSupply),
    ),
    summary: {
      invoiceCount: invoices.length,
      creditNoteCount: returns.length,
      taxablePaise: net.taxablePaise,
      cgstPaise: net.cgstPaise,
      sgstPaise: net.sgstPaise,
      igstPaise: net.igstPaise,
      cessPaise: net.cessPaise,
      totalTaxPaise: net.cgstPaise + net.sgstPaise + net.igstPaise,
      invoiceValuePaise: net.totalPaise,
    },
  };
};

/* ---------------------------- portal JSON export --------------------------- */

const rupees = (paise) => Number(((Number(paise) || 0) / 100).toFixed(2));

const pad = (value) => String(value).padStart(2, "0");

const portalDate = (value) => {
  const date = new Date(value);

  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
};

const portalItems = (row) =>
  row.rateLines.map((line, index) => ({
    num: index + 1,
    itm_det: {
      rt: line.gstRate,
      txval: rupees(line.taxablePaise),
      iamt: rupees(line.igstPaise),
      camt: rupees(line.cgstPaise),
      samt: rupees(line.sgstPaise),
      csamt: rupees(line.cessPaise),
    },
  }));

const groupBy = (rows, keyOf) => {
  const map = new Map();

  for (const row of rows) {
    const key = keyOf(row);

    if (!map.has(key)) map.set(key, []);

    map.get(key).push(row);
  }

  return map;
};

// Structure follows the GST offline-tool / portal GSTR-1 JSON. `pos` must be the
// 2-digit state code, so store the state code in placeOfSupply(Code).
// Validate the output against the current portal schema before filing.
const toPortalJson = ({ report, tenant, fromDate, toDate }) => {
  if (normalizeText(fromDate).slice(0, 7) !== normalizeText(toDate).slice(0, 7)) {
    throw createError("JSON export needs a period inside a single month");
  }

  const [year, month] = normalizeText(fromDate).split("-");

  const invoiceNode = (row, extra = {}) => ({
    inum: row.documentNumber,
    idt: portalDate(row.documentDate),
    val: rupees(row.totalPaise),
    pos: row.placeOfSupply,
    ...extra,
    itms: portalItems(row),
  });

  const noteNode = (row) => ({
    ntty: "C",
    nt_num: row.documentNumber,
    nt_dt: portalDate(row.documentDate),
    val: rupees(row.totalPaise),
    pos: row.placeOfSupply,
    itms: portalItems(row),
  });

  return {
    gstin: normalizeText(tenant?.gstin || tenant?.gstNumber) || null,
    fp: `${month}${year}`,
    b2b: [...groupBy(report.b2b, (row) => row.gstin)].map(([ctin, rows]) => ({
      ctin,
      inv: rows.map((row) =>
        invoiceNode(row, {
          rchrg: row.reverseCharge ? "Y" : "N",
          inv_typ: "R",
        }),
      ),
    })),
    b2cl: [...groupBy(report.b2cl, (row) => row.placeOfSupply)].map(
      ([pos, rows]) => ({
        pos,
        inv: rows.map((row) => invoiceNode(row)),
      }),
    ),
    b2cs: report.b2cs.map((row) => ({
      sply_ty: row.igstPaise > 0 ? "INTER" : "INTRA",
      pos: row.placeOfSupply,
      typ: "OE",
      rt: row.gstRate,
      txval: rupees(row.taxablePaise),
      iamt: rupees(row.igstPaise),
      camt: rupees(row.cgstPaise),
      samt: rupees(row.sgstPaise),
      csamt: rupees(row.cessPaise),
    })),
    cdnr: [...groupBy(report.cdnr, (row) => row.gstin)].map(([ctin, rows]) => ({
      ctin,
      nt: rows.map(noteNode),
    })),
    cdnur: report.cdnur.map((row) => ({ ...noteNode(row), typ: "B2CL" })),
    hsn: {
      data: report.hsn.map((row, index) => ({
        num: index + 1,
        hsn_sc: row.hsnSacCode,
        uqc: row.unit,
        qty: row.quantity,
        rt: row.gstRate,
        val: rupees(row.totalPaise),
        txval: rupees(row.taxablePaise),
        iamt: rupees(row.igstPaise),
        camt: rupees(row.cgstPaise),
        samt: rupees(row.sgstPaise),
        csamt: rupees(row.cessPaise),
      })),
    },
  };
};

/* --------------------------------- GSTR-1 -------------------------------- */

const getGstr1 = async ({
  tenant,
  fromDate,
  toDate,
  section,
  search,
  page,
  limit,
  exportAll,
  format,
}) => {
  const { models, tenantObjectId } = resolveContext({
    tenant,
    required: ["SalesInvoice", "SalesReturn"],
  });

  const { from, to } = parsePeriod(fromDate, toDate, {
    maxDays: MAX_RANGE_DAYS,
  });

  const normalizedSection = normalizeText(section || "B2B").toUpperCase();

  if (!SECTIONS.includes(normalizedSection)) {
    throw createError("Unsupported GSTR-1 section");
  }

  const { currentPage, pageLimit } = parsePaging({ page, limit });

  const report = await buildReport({ models, tenantObjectId, from, to });

  const period = {
    fromDate: normalizeText(fromDate),
    toDate: normalizeText(toDate),
  };

  if (normalizeText(format).toLowerCase() === "json") {
    return {
      period,
      portal: toPortalJson({ report, tenant, fromDate, toDate }),
    };
  }

  const sectionRows = {
    B2B: report.b2b,
    B2CL: report.b2cl,
    B2CS: report.b2cs,
    CDNR: report.cdnr,
    CDNUR: report.cdnur,
    HSN: report.hsn,
  }[normalizedSection];

  const term = normalizeText(search).toLowerCase();

  let fields = ["documentNumber", "customerName", "customerCode", "gstin"];

  if (normalizedSection === "HSN") fields = ["hsnSacCode", "unit"];
  if (normalizedSection === "B2CS") fields = ["placeOfSupply"];

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

  const { nil, exempt, nonGst, zeroRated } = report.outward;

  return {
    period,
    summary: report.summary,
    rateSummary: report.rateSummary,
    nilExempt: {
      nilPaise: nil.taxablePaise,
      exemptPaise: exempt.taxablePaise,
      nonGstPaise: nonGst.taxablePaise,
      zeroRatedPaise: zeroRated.taxablePaise,
    },
    sectionCounts: {
      B2B: report.b2b.length,
      B2CL: report.b2cl.length,
      B2CS: report.b2cs.length,
      CDNR: report.cdnr.length,
      CDNUR: report.cdnur.length,
      HSN: report.hsn.length,
    },
    section: normalizedSection,
    rows,
    exportCap: EXPORT_CAP,
    truncated: isExport && total > EXPORT_CAP,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

/* --------------------------------- GSTR-3B -------------------------------- */

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
        ...JOURNAL_ACTIVE_FILTER,
        postingDate: { $gte: from, $lte: to },
      },
    },
    { $match: { "lines.ledgerId": { $in: ledgerIds } } },
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

/**
 * ITC utilisation (CGST Rule 88A):
 *  - IGST credit: against IGST, then CGST, then SGST
 *  - CGST credit: against CGST, then IGST (never SGST)
 *  - SGST credit: against SGST, then IGST (never CGST)
 */
const utiliseCredit = (liability, credit) => {
  const need = {};
  const have = {};
  const paid = {};

  for (const head of TAX_HEADS) {
    need[head] = Math.max(liability[head], 0);
    have[head] = Math.max(credit[head], 0);
    paid[head] = { CGST: 0, SGST: 0, IGST: 0 };
  }

  const apply = (from, to) => {
    const amount = Math.min(have[from], need[to]);

    paid[from][to] += amount;
    have[from] -= amount;
    need[to] -= amount;
  };

  apply("IGST", "IGST");
  apply("IGST", "CGST");
  apply("IGST", "SGST");
  apply("CGST", "CGST");
  apply("CGST", "IGST");
  apply("SGST", "SGST");
  apply("SGST", "IGST");

  return { paid, cash: need, carryForward: have };
};

const getGstr3b = async ({ tenant, fromDate, toDate }) => {
  const { models, tenantObjectId } = resolveContext({
    tenant,
    required: ["SalesInvoice", "SalesReturn", "Journal", "TaxConfiguration"],
  });

  const { from, to } = parsePeriod(fromDate, toDate, {
    maxDays: MAX_RANGE_DAYS,
  });

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

  const liability = {};
  const credit = {};
  const claimed = { totalPaise: 0 };
  const reversed = { totalPaise: 0 };
  const itc = { totalPaise: 0 };
  const reconciliation = [];

  for (const head of TAX_HEADS) {
    const key = HEAD_KEYS[head];

    const outputId = configuration?.[OUTPUT_LEDGER_FIELDS[head]];
    const inputId = configuration?.[INPUT_LEDGER_FIELDS[head]];

    const outputLedger =
      (outputId && ledgerTotals.get(String(outputId))) || zero;
    const inputLedger = (inputId && ledgerTotals.get(String(inputId))) || zero;

    const documentPaise = report.summary[key];
    const ledgerPaise = outputLedger.creditPaise - outputLedger.debitPaise;
    const netItc = inputLedger.debitPaise - inputLedger.creditPaise;

    liability[head] = documentPaise;
    credit[head] = netItc;

    claimed[key] = inputLedger.debitPaise;
    reversed[key] = inputLedger.creditPaise;
    itc[key] = netItc;

    claimed.totalPaise += inputLedger.debitPaise;
    reversed.totalPaise += inputLedger.creditPaise;
    itc.totalPaise += netItc;

    reconciliation.push({
      taxHead: head,
      documentPaise,
      ledgerPaise,
      differencePaise: documentPaise - ledgerPaise,
      mapped: Boolean(outputId),
    });
  }

  const { paid, cash, carryForward } = utiliseCredit(liability, credit);

  const payable = TAX_HEADS.map((head) => {
    const paidFromIgst = paid.IGST[head];
    const paidFromCgst = paid.CGST[head];
    const paidFromSgst = paid.SGST[head];

    return {
      taxHead: head,
      outputPaise: liability[head],
      itcPaise: credit[head],
      paidFromIgstPaise: paidFromIgst,
      paidFromCgstPaise: paidFromCgst,
      paidFromSgstPaise: paidFromSgst,
      utilisedPaise: paidFromIgst + paidFromCgst + paidFromSgst,
      cashPaise: cash[head],
      carryForwardPaise: carryForward[head],
    };
  });

  const totals = payable.reduce(
    (sum, row) => ({
      outputPaise: sum.outputPaise + row.outputPaise,
      itcPaise: sum.itcPaise + row.itcPaise,
      utilisedPaise: sum.utilisedPaise + row.utilisedPaise,
      cashPaise: sum.cashPaise + row.cashPaise,
      carryForwardPaise: sum.carryForwardPaise + row.carryForwardPaise,
    }),
    {
      outputPaise: 0,
      itcPaise: 0,
      utilisedPaise: 0,
      cashPaise: 0,
      carryForwardPaise: 0,
    },
  );

  const { taxable, zeroRated, nil, exempt, nonGst } = report.outward;

  return {
    configured: Boolean(configuration),
    period: {
      fromDate: normalizeText(fromDate),
      toDate: normalizeText(toDate),
    },
    outward: {
      taxable, // 3.1(a)
      zeroRated, // 3.1(b)
      nilExempt: {
        taxablePaise: nil.taxablePaise + exempt.taxablePaise, // 3.1(c)
      },
      nonGst: { taxablePaise: nonGst.taxablePaise }, // 3.1(e)
    },
    interStateUnregistered: report.interStateUnregistered, // 3.2
    itc: { ...itc, claimed, reversed },
    payable,
    totals,
    reconciliation,
  };
};

module.exports = { getGstr1, getGstr3b };