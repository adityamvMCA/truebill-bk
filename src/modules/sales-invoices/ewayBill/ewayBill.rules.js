"use strict";

/*
 * Pure e-way bill rules. No database access, so everything here
 * can be unit tested and reused by the service.
 */

const EWB_THRESHOLD_PAISE = 5000000; // consignment value above Rs 50,000
const MAX_DISTANCE_KM = 4000;

const TRANSPORT_MODES = ["ROAD", "RAIL", "AIR", "SHIP"];
const MODE_CODE = { ROAD: 1, RAIL: 2, AIR: 3, SHIP: 4 };

const VEHICLE_TYPES = ["REGULAR", "ODC"];

const CANCEL_REASONS = [
  "DUPLICATE",
  "ORDER_CANCELLED",
  "DATA_ENTRY_MISTAKE",
  "OTHERS",
];

const VEHICLE_UPDATE_REASONS = [
  "BREAKDOWN",
  "TRANSHIPMENT",
  "FIRST_TIME",
  "OTHERS",
];

const EXTEND_REASONS = [
  "NATURAL_CALAMITY",
  "LAW_AND_ORDER",
  "TRANSSHIPMENT",
  "ACCIDENT",
  "OTHERS",
];

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const STATE_CODE_REGEX = /^(0[1-9]|[12][0-9]|3[0-8]|97|99)$/;
const EWB_NUMBER_REGEX = /^[0-9]{12}$/;

// Regular (MH12AB1234), Bharat series (22BH1234AA), temporary (TM123456)
const VEHICLE_REGEX =
  /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2}|TM[0-9]{6}[A-Z]?)$/;

const DOC_NUMBER_REGEX = /^[A-Z0-9/-]{1,16}$/;

const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXTEND_WINDOW_MS = 8 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;

/* ==========================================
   GOODS VALUE / REQUIREMENT
   ========================================== */

const goodsItemsOf = (invoice) =>
  (invoice?.items || []).filter((item) => item.productType === "GOODS");

const goodsTotals = (invoice) => {
  const goods = goodsItemsOf(invoice);

  const sum = (field) =>
    goods.reduce((total, item) => total + (Number(item[field]) || 0), 0);

  return {
    hasGoods: goods.length > 0,
    taxable: sum("taxableAmountPaise"),
    cgst: sum("cgstAmountPaise"),
    sgst: sum("sgstAmountPaise"),
    igst: sum("igstAmountPaise"),
    total: sum("totalAmountPaise"),
  };
};

const isEwayBillRequired = (invoice) => {
  const totals = goodsTotals(invoice);

  return totals.hasGoods && totals.total > EWB_THRESHOLD_PAISE;
};

/*
 * NOT_APPLICABLE  no goods on the invoice
 * NOT_REQUIRED    goods value is at or below the threshold
 * PENDING         required and not generated
 * GENERATED       valid e-way bill recorded
 * EXPIRED         generated, validity has passed
 * CANCELLED       generated earlier, then cancelled
 */
const deriveState = (invoice, now = new Date()) => {
  const ewb = invoice?.ewayBill || {};

  if (ewb.status === "GENERATED") {
    return ewb.validUntil && new Date(ewb.validUntil) <= now
      ? "EXPIRED"
      : "GENERATED";
  }

  if (!goodsTotals(invoice).hasGoods) return "NOT_APPLICABLE";

  if (ewb.status === "CANCELLED") return "CANCELLED";

  return isEwayBillRequired(invoice) ? "PENDING" : "NOT_REQUIRED";
};

/* ==========================================
   VALIDITY
   ========================================== */

const endOfIstDay = (instant, plusDays) => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);

  const end = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + plusDays,
    23,
    59,
    59,
    999,
  );

  return new Date(end - IST_OFFSET_MS);
};

// 1 day per 200 km (20 km for over-dimensional cargo), part thereof.
const validityDays = (distanceKm, vehicleType) =>
  Math.max(1, Math.ceil(distanceKm / (vehicleType === "ODC" ? 20 : 200)));

/*
 * Suggestion only. The portal's own validity is authoritative and
 * is what the user records.
 */
const computeValidUntil = (generatedAt, distanceKm, vehicleType) =>
  endOfIstDay(generatedAt, validityDays(distanceKm, vehicleType));

/* ==========================================
   PORTAL JSON
   ========================================== */

const clean = (value, max) =>
  String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^A-Za-z0-9 .,/#&()\-:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const splitAddress = (value) => {
  const text = clean(value, 240);

  return [text.slice(0, 120), text.slice(120, 240)];
};

const rupees = (paise) => Number((Number(paise || 0) / 100).toFixed(2));

const formatDocDate = (date) => {
  const value = new Date(date);

  return [
    String(value.getUTCDate()).padStart(2, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    value.getUTCFullYear(),
  ].join("/");
};

const UQC = {
  NOS: "NOS",
  NO: "NOS",
  PCS: "PCS",
  PC: "PCS",
  PIECE: "PCS",
  PIECES: "PCS",
  KG: "KGS",
  KGS: "KGS",
  GM: "GMS",
  GMS: "GMS",
  G: "GMS",
  LTR: "LTR",
  L: "LTR",
  LITRE: "LTR",
  ML: "MLT",
  MLT: "MLT",
  MTR: "MTR",
  M: "MTR",
  METER: "MTR",
  CM: "CMS",
  CMS: "CMS",
  SQM: "SQM",
  SQF: "SQF",
  SQFT: "SQF",
  BOX: "BOX",
  BAG: "BAG",
  BAGS: "BAG",
  SET: "SET",
  SETS: "SET",
  PAC: "PAC",
  PKT: "PAC",
  PACK: "PAC",
  TON: "TON",
  TONS: "TON",
  DOZ: "DOZ",
  DZ: "DOZ",
  PAIR: "PRS",
  PRS: "PRS",
  ROLL: "ROL",
  ROL: "ROL",
  BTL: "BTL",
  BOTTLE: "BTL",
  CAN: "CAN",
  CTN: "CTN",
  CARTON: "CTN",
  BUN: "BDL",
  BDL: "BDL",
  BUNDLE: "BDL",
};

const toUqc = (unit) =>
  UQC[
    String(unit || "")
      .trim()
      .toUpperCase()
  ] || "OTH";

const hsnDigits = (value) => String(value ?? "").replace(/\D/g, "");

const stateOfGstin = (gstin) =>
  GSTIN_REGEX.test(String(gstin || "")) ? gstin.slice(0, 2) : null;

/*
 * Returns a list of human readable problems. Empty means the
 * invoice can be exported to the portal.
 */
const validateForGeneration = (invoice, supplier) => {
  const messages = [];
  const ewb = invoice.ewayBill || {};
  const totals = goodsTotals(invoice);

  if (invoice.status !== "POSTED") {
    messages.push("Post the invoice before generating an e-way bill.");
  }

  if (!totals.hasGoods) {
    messages.push("E-way bills apply only to invoices that contain goods.");
  }

  if (!DOC_NUMBER_REGEX.test(invoice.invoiceNumber || "")) {
    messages.push(
      "The portal accepts document numbers of up to 16 characters using letters, digits, / and - only.",
    );
  }

  if (!GSTIN_REGEX.test(supplier?.gstin || "")) {
    messages.push("Your business GSTIN is missing or invalid.");
  }

  if (!supplier?.name || !supplier?.address) {
    messages.push("Your business name and address are required.");
  }

  if (!PINCODE_REGEX.test(String(supplier?.pincode || ""))) {
    messages.push("Your business pincode is missing or invalid.");
  }

  if (invoice.customerGstNo && !GSTIN_REGEX.test(invoice.customerGstNo)) {
    messages.push("The customer GSTIN on this invoice is invalid.");
  }

  for (const [label, key] of [
    ["Dispatch place", "fromPlace"],
    ["Dispatch pincode", "fromPincode"],
    ["Dispatch state", "fromStateCode"],
    ["Delivery place", "toPlace"],
    ["Delivery pincode", "toPincode"],
    ["Delivery state", "toStateCode"],
    ["Distance", "distanceKm"],
  ]) {
    if (!ewb[key]) messages.push(`${label} is required.`);
  }

  if (ewb.fromPincode && !PINCODE_REGEX.test(ewb.fromPincode)) {
    messages.push("Dispatch pincode is invalid.");
  }

  if (ewb.toPincode && !PINCODE_REGEX.test(ewb.toPincode)) {
    messages.push("Delivery pincode is invalid.");
  }

  if (ewb.transportMode === "ROAD") {
    if (!ewb.vehicleNumber && !ewb.transporterId) {
      messages.push(
        "Enter a vehicle number or a transporter GSTIN for road transport.",
      );
    }
  } else if (!ewb.transportDocNumber || !ewb.transportDocDate) {
    messages.push(
      "Transport document number and date are required for rail, air or ship.",
    );
  }

  goodsItemsOf(invoice).forEach((item, index) => {
    if (hsnDigits(item.hsnSacCode).length < 4) {
      messages.push(
        `${item.productName || `Goods item ${index + 1}`}: HSN code of at least 4 digits is required.`,
      );
    }
  });

  return messages;
};

const buildPortalPayload = (invoice, supplier) => {
  const ewb = invoice.ewayBill || {};
  const totals = goodsTotals(invoice);

  const supplierState = supplier.stateCode || stateOfGstin(supplier.gstin);

  const recipientState = stateOfGstin(invoice.customerGstNo) || ewb.toStateCode;

  const fromDiffers = String(supplierState) !== String(ewb.fromStateCode);
  const toDiffers = String(recipientState) !== String(ewb.toStateCode);

  // 1 Regular, 2 Bill To-Ship To, 3 Bill From-Dispatch From, 4 Combination
  const transType =
    fromDiffers && toDiffers ? 4 : toDiffers ? 2 : fromDiffers ? 3 : 1;

  const [fromAddr1, fromAddr2] = splitAddress(supplier.address);

  const [toAddr1, toAddr2] = splitAddress(
    invoice.shippingAddress || invoice.billingAddress || ewb.toPlace,
  );

  const itemList = goodsItemsOf(invoice).map((item) => {
    const rate = Number(item.gstRate) || 0;
    const intra = invoice.taxMode === "INTRA_STATE";
    const inter = invoice.taxMode === "INTER_STATE";

    return {
      productName: clean(item.productName, 100),
      productDesc: clean(item.specification || item.productName, 100),
      hsnCode: Number(hsnDigits(item.hsnSacCode)),
      quantity: item.quantity,
      qtyUnit: toUqc(item.unit),
      taxableAmount: rupees(item.taxableAmountPaise),
      cgstRate: intra ? rate / 2 : 0,
      sgstRate: intra ? rate / 2 : 0,
      igstRate: inter ? rate : 0,
      cessRate: 0,
    };
  });

  const bill = {
    userGstin: supplier.gstin,
    supplyType: "O",
    subSupplyType: 1,
    subSupplyDesc: "",
    docType: "INV",
    docNo: invoice.invoiceNumber,
    docDate: formatDocDate(invoice.invoiceDate),

    transType,

    fromGstin: supplier.gstin,
    fromTrdName: clean(supplier.name, 100),
    fromAddr1,
    fromAddr2,
    fromPlace: clean(ewb.fromPlace, 50),
    fromPincode: Number(ewb.fromPincode),
    fromStateCode: Number(supplierState),
    actualFromStateCode: Number(ewb.fromStateCode),

    toGstin: invoice.customerGstNo || "URP",
    toTrdName: clean(invoice.customerName, 100),
    toAddr1,
    toAddr2,
    toPlace: clean(ewb.toPlace, 50),
    toPincode: Number(ewb.toPincode),
    toStateCode: Number(recipientState),
    actualToStateCode: Number(ewb.toStateCode),

    totalValue: rupees(totals.taxable),
    cgstValue: rupees(totals.cgst),
    sgstValue: rupees(totals.sgst),
    igstValue: rupees(totals.igst),
    cessValue: 0,
    cessNonAdvolValue: 0,
    otherValue: 0,
    totInvValue: rupees(totals.total),

    transMode: MODE_CODE[ewb.transportMode],
    transDistance: String(ewb.distanceKm),

    itemList,
  };

  if (ewb.transporterName)
    bill.transporterName = clean(ewb.transporterName, 100);
  if (ewb.transporterId) bill.transporterId = ewb.transporterId;
  if (ewb.transportDocNumber)
    bill.transDocNo = clean(ewb.transportDocNumber, 15);
  if (ewb.transportDocDate)
    bill.transDocDate = formatDocDate(ewb.transportDocDate);
  if (ewb.vehicleNumber) {
    bill.vehicleNo = ewb.vehicleNumber;
    bill.vehicleType = ewb.vehicleType === "ODC" ? "O" : "R";
  }

  return {
    version: "1.0.0621",
    billLists: [bill],
  };
};

module.exports = {
  EWB_THRESHOLD_PAISE,
  MAX_DISTANCE_KM,
  TRANSPORT_MODES,
  VEHICLE_TYPES,
  CANCEL_REASONS,
  VEHICLE_UPDATE_REASONS,
  EXTEND_REASONS,
  GSTIN_REGEX,
  PINCODE_REGEX,
  STATE_CODE_REGEX,
  EWB_NUMBER_REGEX,
  VEHICLE_REGEX,
  CANCEL_WINDOW_MS,
  EXTEND_WINDOW_MS,
  IST_OFFSET_MS,
  goodsTotals,
  isEwayBillRequired,
  deriveState,
  validityDays,
  computeValidUntil,
  validateForGeneration,
  buildPortalPayload,
};
