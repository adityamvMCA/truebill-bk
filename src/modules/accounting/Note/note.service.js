const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");
const { getNextSequence } = require("../../../utils/sequenceGenerator");
const { postJournal } = require("../../accounting/journals/journal.service");

const REASONS = [
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "DAMAGED_GOODS",
  "QUANTITY_SHORTAGE",
  "PRICE_ADJUSTMENT",
  "DISCOUNT",
  "RATE_DIFFERENCE",
  "TAX_CORRECTION",
  "OTHER",
];
const GOODS_REASONS = new Set([
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "DAMAGED_GOODS",
  "QUANTITY_SHORTAGE",
]);
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const createError = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const text = (v) => String(v ?? "").trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const requireId = (v, name) => {
  if (!mongoose.isObjectIdOrHexString(v))
    throw createError(`${name} must be a valid ObjectId`);
  return new mongoose.Types.ObjectId(String(v));
};

const parseDate = (v, name) => {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw createError(`${name} is invalid`);
  return d;
};

/**
 * Tax in paise, integer maths only. Intra-state splits tax in two;
 * the odd paisa goes to SGST so CGST + SGST always equals the line tax.
 */
const computeLine = (line, index, isInterState) => {
  const n = index + 1;
  const description = text(line?.description);
  if (!description) throw createError(`Line ${n} needs a description`);

  const taxablePaise = line.taxablePaise;
  if (!Number.isSafeInteger(taxablePaise) || taxablePaise < 1) {
    throw createError(`Line ${n} taxablePaise must be a positive integer`);
  }

  const gstRate = Number(line.gstRate);
  if (!GST_RATES.includes(gstRate))
    throw createError(`Line ${n} has an unsupported GST rate`);

  const taxPaise = Math.round((taxablePaise * gstRate) / 100);
  const igstPaise = isInterState ? taxPaise : 0;
  const cgstPaise = isInterState ? 0 : Math.floor(taxPaise / 2);
  const sgstPaise = isInterState ? 0 : taxPaise - cgstPaise;

  return {
    description,
    hsnSac: text(line.hsnSac).toUpperCase() || null,
    quantity:
      line.quantity === undefined ||
      line.quantity === null ||
      line.quantity === ""
        ? null
        : Number(line.quantity),
    unit: text(line.unit) || null,
    taxablePaise,
    gstRate,
    cgstPaise,
    sgstPaise,
    igstPaise,
    lineTotalPaise: taxablePaise + taxPaise,
  };
};

const sumLines = (lines) =>
  lines.reduce(
    (t, l) => ({
      taxable: t.taxable + l.taxablePaise,
      cgst: t.cgst + l.cgstPaise,
      sgst: t.sgst + l.sgstPaise,
      igst: t.igst + l.igstPaise,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
  );

/**
 * One posting rule covers all four combinations:
 *   Debit note  -> DEBIT the party ledger, credit adjustment + tax ledgers
 *   Credit note -> CREDIT the party ledger, debit adjustment + tax ledgers
 *
 *   Customer + Credit : receivable down, output GST down (post-sale discount, sales return)
 *   Customer + Debit  : receivable up,   output GST up   (price increase, short billing)
 *   Supplier + Debit  : payable down,    ITC reversed    (purchase return, price reduction)
 *   Supplier + Credit : payable up,      ITC increased   (supplier under-billed)
 *
 * Tax goes to OUTPUT ledgers for customers and INPUT ledgers for suppliers,
 * so the existing GST Summary picks these notes up with no extra work.
 */
const buildJournalLines = ({
  noteType,
  partyLedgerId,
  adjustmentLedgerId,
  taxLedgers,
  totals,
  narration,
}) => {
  const partyIsDebit = noteType === "DEBIT_NOTE";
  const side = (amount, isDebit) => ({
    debitPaise: isDebit ? amount : 0,
    creditPaise: isDebit ? 0 : amount,
  });

  const totalTax = totals.cgst + totals.sgst + totals.igst;

  const lines = [
    {
      ledgerId: partyLedgerId,
      ...side(totals.taxable + totalTax, partyIsDebit),
      narration,
    },
    {
      ledgerId: adjustmentLedgerId,
      ...side(totals.taxable, !partyIsDebit),
      narration,
    },
  ];

  for (const [head, amount] of [
    ["CGST", totals.cgst],
    ["SGST", totals.sgst],
    ["IGST", totals.igst],
  ]) {
    if (amount > 0) {
      lines.push({
        ledgerId: taxLedgers[head],
        ...side(amount, !partyIsDebit),
        narration,
      });
    }
  }
  return lines;
};

const createNote = async ({ tenant, connection, userId, body, session }) => {
  const { TaxConfiguration, AccountingNote: Note } =
    getTenantAccountingModels(connection);
  if (!Note)
    throw createError("Tenant model AccountingNote is unavailable", 500);

  const tenantId = requireId(tenant?._id ?? tenant?.id, "tenantId");

  const noteType = text(body.noteType).toUpperCase();
  const partyType = text(body.partyType).toUpperCase();
  if (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(noteType))
    throw createError("Unsupported note type");
  if (!["CUSTOMER", "SUPPLIER"].includes(partyType))
    throw createError("Unsupported party type");

  const reason = text(body.reason).toUpperCase();
  if (!REASONS.includes(reason)) throw createError("Unsupported reason");

  const partyName = text(body.partyName);
  if (!partyName) throw createError("partyName is required");

  const partyGstin = text(body.partyGstin).toUpperCase() || null;
  if (partyGstin && !GSTIN_RE.test(partyGstin))
    throw createError("partyGstin is not a valid GSTIN");

  // A registered party's note must reference the original document (GSTR-1 CDNR / GSTR-2B matching).
  const originalDocNumber = text(body.originalDocNumber).toUpperCase() || null;
  if (partyGstin && !originalDocNumber) {
    throw createError(
      "Original invoice/bill number is required for a GST-registered party",
    );
  }

  const noteDate = parseDate(body.noteDate, "noteDate");
  const originalDocDate = body.originalDocDate
    ? parseDate(body.originalDocDate, "originalDocDate")
    : null;
  if (originalDocDate && originalDocDate > noteDate) {
    throw createError("Original document date cannot be after the note date");
  }

  const isInterState = Boolean(body.isInterState);
  const partyLedgerId = requireId(body.partyLedgerId, "partyLedgerId");
  const adjustmentLedgerId = requireId(
    body.adjustmentLedgerId,
    "adjustmentLedgerId",
  );
  if (String(partyLedgerId) === String(adjustmentLedgerId)) {
    throw createError("Party ledger and adjustment ledger must be different");
  }

  if (
    !Array.isArray(body.lines) ||
    body.lines.length < 1 ||
    body.lines.length > 200
  ) {
    throw createError("A note needs between 1 and 200 lines");
  }
  const lines = body.lines.map((l, i) => computeLine(l, i, isInterState));
  const totals = sumLines(lines);
  const totalTaxPaise = totals.cgst + totals.sgst + totals.igst;

  // Resolve tax ledgers from the existing Tax Configuration.
  let taxLedgers = {};
  if (totalTaxPaise > 0) {
    const config = await TaxConfiguration.findOne({ tenantId })
      .session(session)
      .lean();
    const prefix = partyType === "CUSTOMER" ? "output" : "input";
    taxLedgers = {
      CGST: config?.[`${prefix}CgstLedgerId`],
      SGST: config?.[`${prefix}SgstLedgerId`],
      IGST: config?.[`${prefix}IgstLedgerId`],
    };
    for (const [head, amount] of [
      ["CGST", totals.cgst],
      ["SGST", totals.sgst],
      ["IGST", totals.igst],
    ]) {
      if (amount > 0 && !taxLedgers[head]) {
        throw createError(
          `${prefix} ${head} ledger is not configured in Tax Configuration`,
          409,
        );
      }
    }
  }

  const noteId = new mongoose.Types.ObjectId();
  const noteNumber = await getNextSequence(
    noteType === "CREDIT_NOTE" ? "CN" : "DN",
    tenantId.toString(),
    3,
    { connection, session },
  );
  const narration = text(body.narration) || null;

  const journal = await postJournal({
    tenant,
    connection,
    userId,
    postingDate: noteDate,
    sourceType: noteType,
    sourceId: noteId,
    sourceNumber: noteNumber,
    narration:
      narration ||
      `${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note ${noteNumber} - ${partyName}`,
    lines: buildJournalLines({
      noteType,
      partyLedgerId,
      adjustmentLedgerId,
      taxLedgers,
      totals,
      narration,
    }),
    session,
  });

  const [note] = await Note.create(
    [
      {
        _id: noteId,
        tenantId,
        noteNumber,
        noteType,
        partyType,
        partyId: body.partyId ? requireId(body.partyId, "partyId") : null,
        partyLedgerId,
        partyName,
        partyGstin,
        adjustmentLedgerId,
        noteDate,
        reason,
        isGoodsRelated: GOODS_REASONS.has(reason),
        isInterState,
        originalDocType:
          partyType === "CUSTOMER" ? "SALES_INVOICE" : "PURCHASE_BILL",
        originalDocId: body.originalDocId
          ? requireId(body.originalDocId, "originalDocId")
          : null,
        originalDocNumber,
        originalDocDate,
        lines,
        totalTaxablePaise: totals.taxable,
        totalCgstPaise: totals.cgst,
        totalSgstPaise: totals.sgst,
        totalIgstPaise: totals.igst,
        totalTaxPaise,
        totalAmountPaise: totals.taxable + totalTaxPaise,
        narration,
        status: "POSTED",
        journalId: journal._id,
        journalNumber: journal.journalNumber,
        createdBy: userId,
      },
    ],
    { session, ordered: true },
  );

  return note;
};

const listNotes = async ({
  tenant,
  connection,
  noteType,
  partyType,
  search,
  fromDate,
  toDate,
  page = 1,
  limit = 10,
}) => {
  const { AccountingNote: Note } = getTenantAccountingModels(connection);
  const tenantId = requireId(tenant?._id ?? tenant?.id, "tenantId");

  const currentPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 10, 1),
    100,
  );

  const match = { tenantId };
  if (noteType) match.noteType = text(noteType).toUpperCase();
  if (partyType) match.partyType = text(partyType).toUpperCase();

  if (fromDate || toDate) {
    match.noteDate = {};
    if (fromDate)
      match.noteDate.$gte = new Date(`${text(fromDate)}T00:00:00.000Z`);
    if (toDate) match.noteDate.$lte = new Date(`${text(toDate)}T23:59:59.999Z`);
  }

  const q = text(search);
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    match.$or = [
      { noteNumber: rx },
      { partyName: rx },
      { originalDocNumber: rx },
      { journalNumber: rx },
    ];
  }

  const [rows, total] = await Promise.all([
    Note.find(match)
      .sort({ noteDate: -1, _id: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .select("-lines")
      .lean(),
    Note.countDocuments(match),
  ]);

  return {
    data: rows,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getNoteById = async ({ tenant, connection, id }) => {
  const { AccountingNote: Note } = getTenantAccountingModels(connection);
  const tenantId = requireId(tenant?._id ?? tenant?.id, "tenantId");
  const note = await Note.findOne({
    _id: requireId(id, "id"),
    tenantId,
  }).lean();
  if (!note) throw createError("Note not found", 404);
  return note;
};

module.exports = { createNote, listNotes, getNoteById, computeLine };
