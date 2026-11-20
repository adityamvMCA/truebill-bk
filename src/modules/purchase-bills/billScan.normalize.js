const GST_RATES = [0, 3, 5, 12, 18, 28];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const STATE_BY_GST_CODE = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

const UNIT_MAP = {
  pcs: "PCS", pc: "PCS", piece: "PCS", pieces: "PCS",
  nos: "NOS", no: "NOS", number: "NOS", numbers: "NOS", unit: "NOS", units: "NOS", ea: "NOS", each: "NOS",
  kg: "KG", kgs: "KG", kilogram: "KG", kilograms: "KG",
  g: "GRAM", gm: "GRAM", gms: "GRAM", gram: "GRAM", grams: "GRAM",
  ton: "TON", tons: "TON", tonne: "TON", tonnes: "TON", mt: "TON",
  l: "LITRE", ltr: "LITRE", ltrs: "LITRE", litre: "LITRE", litres: "LITRE", liter: "LITRE", liters: "LITRE",
  ml: "ML",
  m: "METER", mtr: "METER", mtrs: "METER", meter: "METER", meters: "METER", metre: "METER", metres: "METER",
  ft: "FEET", feet: "FEET", foot: "FEET",
  sqft: "SQFT", sqm: "SQM",
  box: "BOX", boxes: "BOX", bag: "BAG", bags: "BAG",
  pack: "PACK", packs: "PACK", pkt: "PACK", pkts: "PACK",
  set: "SET", sets: "SET",
  hr: "HOUR", hrs: "HOUR", hour: "HOUR", hours: "HOUR",
  day: "DAY", days: "DAY", month: "MONTH", months: "MONTH",
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const SERVICE_WORDS = /\b(freight|transport|transportation|labou?r|service|services|installation|packing|packaging|courier|cartage|delivery|loading|unloading|handling|commission|insurance)\b/i;

/*
 * Printed form labels that a model can mistake for a value when the real
 * box is empty (e.g. "Mode/Terms of Payment" empty -> "Other Reference(s)").
 */
const LABEL_NOISE =
  /^(other reference|reference|mode\s*\/?\s*terms|terms of (payment|delivery)|dated|delivery note|buyer'?s order|supplier'?s ref|despatch|destination|e-?way|invoice no)/i;

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const original = value.trim();
  if (!original) return null;

  const negative = /^\(.*\)$/.test(original) || /^-/.test(original);
  let cleaned = original.replace(/[^0-9.,]/g, "");

  if (/^\d+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", "."); // decimal comma
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const number = Number(cleaned);
  if (!cleaned || !Number.isFinite(number)) return null;

  return negative ? -number : number;
};

const text = (value, max = 500) => {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, max) : "";
};

/* Like text(), but returns "" when the value is just a printed form label. */
const cleanField = (value, max = 500) => {
  const result = text(value, max);
  return result && !LABEL_NOISE.test(result) ? result : "";
};

const pad = (number) => String(number).padStart(2, "0");

const validYmd = (year, month, day) => {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
};

const parseDate = (value) => {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input) return null;

  let match = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return validYmd(+match[1], +match[2], +match[3]);

  match = input.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (match) {
    let year = +match[3];
    if (year < 100) year += 2000;
    return validYmd(year, +match[2], +match[1]);
  }

  match = input.match(/^(\d{1,2})(?:st|nd|rd|th)?[-/. ,]*([A-Za-z]{3,9})[-/. ,]*(\d{2,4})$/);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    let year = +match[3];
    if (year < 100) year += 2000;
    return month ? validYmd(year, month, +match[1]) : null;
  }

  match = input.match(/^([A-Za-z]{3,9})[ .,-]+(\d{1,2})(?:st|nd|rd|th)?[ .,-]+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    return month ? validYmd(+match[3], month, +match[2]) : null;
  }

  return null;
};

const normalizeUnit = (value) => {
  const key = String(value || "").toLowerCase().replace(/[.\s]/g, "");
  return UNIT_MAP[key] || "NOS";
};

const snapGstRate = (value, taxMode) => {
  const number = toNumber(value);
  if (number === null || number < 0) return null;
  if (GST_RATES.includes(number)) return number;

  // Some invoices print only the CGST (or SGST) half-rate.
  if (taxMode === "INTRA_STATE" && GST_RATES.includes(number * 2)) return number * 2;

  const nearest = GST_RATES.reduce((best, rate) =>
    Math.abs(rate - number) < Math.abs(best - number) ? rate : best,
  );

  return Math.abs(nearest - number) <= 0.5 ? nearest : null;
};

const normalizeExtraction = (raw) => {
  const warnings = [];
  const supplierRaw = raw.supplier || {};
  const invoiceRaw = raw.invoice || {};
  const totalsRaw = raw.totals || {};

  /* ---- supplier ---- */
  let gstin = text(supplierRaw.gstin, 30).toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (gstin && !GSTIN_RE.test(gstin)) {
    warnings.push(`Supplier GSTIN "${gstin}" is not a valid GSTIN. Check it against the bill.`);
    gstin = "";
  }

  const stateFromGstin = gstin ? STATE_BY_GST_CODE[gstin.slice(0, 2)] : "";

  const phoneDigits = String(supplierRaw.phone || "").replace(/\D/g, "");
  const email = text(supplierRaw.email, 120).toLowerCase();

  const supplier = {
    name: text(supplierRaw.name, 150),
    gstin,
    pan: gstin ? gstin.slice(2, 12) : text(supplierRaw.pan, 12).toUpperCase(),
    phone: phoneDigits.length >= 10 ? phoneDigits.slice(-10) : "",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    address: text(supplierRaw.address, 300),
    city: text(supplierRaw.city, 80),
    state: text(supplierRaw.state, 80) || stateFromGstin || "",
    pincode: (String(supplierRaw.pincode || "").match(/\d{6}/) || [""])[0],
  };

  if (!supplier.name) warnings.push("Supplier name could not be read from the bill.");

  /* ---- invoice ---- */
  const invoice = {
    number: cleanField(invoiceRaw.number, 100),
    date: parseDate(invoiceRaw.date),
    dueDate: parseDate(invoiceRaw.dueDate),
    paymentTerms: cleanField(invoiceRaw.paymentTerms, 100),
  };

  if (!invoice.number) warnings.push("Supplier invoice number could not be read.");
  if (!invoice.date) warnings.push("Invoice date could not be read. Today's date was used.");
  if (invoice.date && invoice.dueDate && invoice.dueDate < invoice.date) invoice.dueDate = null;

  /* ---- totals + tax mode ---- */
  const totals = {
    taxable: toNumber(totalsRaw.taxable),
    cgst: toNumber(totalsRaw.cgst),
    sgst: toNumber(totalsRaw.sgst),
    igst: toNumber(totalsRaw.igst),
    roundOff: toNumber(totalsRaw.roundOff),
    total: toNumber(totalsRaw.total),
  };

  const rawItems = Array.isArray(raw.items) ? raw.items.slice(0, 200) : [];

  let taxMode = "NONE";
  let taxModeCertain = true;

  if ((totals.igst || 0) > 0) {
    taxMode = "INTER_STATE";
  } else if ((totals.cgst || 0) > 0 || (totals.sgst || 0) > 0) {
    taxMode = "INTRA_STATE";
  } else if (rawItems.some((item) => (toNumber(item?.gstRate) || 0) > 0)) {
    taxMode = "INTRA_STATE";
    taxModeCertain = false;
  }

  if (!taxModeCertain) {
    warnings.push("Could not tell whether CGST+SGST or IGST applies. Please verify the tax treatment.");
  }

  const totalTax = (totals.cgst || 0) + (totals.sgst || 0) + (totals.igst || 0);
  const overallRate =
    totals.taxable && totalTax > 0 ? snapGstRate(round((totalTax / totals.taxable) * 100, 2), "NONE") : null;

  /* ---- items ---- */
  const items = [];

  for (const source of rawItems) {
    if (!source || typeof source !== "object") continue;

    const description = text(source.description, 200);
    const amount = toNumber(source.amount);

    if (!description && amount === null) continue;

    const flags = [];

    let quantity = toNumber(source.quantity);
    if (quantity === null || quantity <= 0) {
      quantity = 1;
      flags.push("Quantity missing, set to 1");
    }
    quantity = round(Math.min(quantity, 1000000), 3);

    let discountPercent = toNumber(source.discountPercent);
    let rate = toNumber(source.unitRate);
    const discountAmount = toNumber(source.discountAmount);

    if (rate === null || rate < 0 || (rate === 0 && amount > 0)) {
      if (amount !== null && amount >= 0) {
        const factor = quantity * (1 - (discountPercent || 0) / 100);
        rate = factor > 0 ? round(amount / factor, 2) : 0;
        flags.push("Rate calculated from line amount");
      } else {
        rate = 0;
        flags.push("Rate missing");
      }
    }

    if ((discountPercent === null || discountPercent <= 0) && discountAmount > 0 && rate > 0) {
      discountPercent = round((discountAmount / (rate * quantity)) * 100, 2);
    }

    discountPercent = Math.min(Math.max(discountPercent || 0, 0), 100);

    let gstRate = snapGstRate(source.gstRate, taxMode);

    if (gstRate === null) {
      if (taxMode === "NONE") {
        gstRate = 0;
      } else if (overallRate !== null) {
        gstRate = overallRate;
        flags.push("GST rate taken from bill totals");
      } else {
        gstRate = 0;
        flags.push("GST rate missing");
      }
    }

    if (taxMode === "NONE") gstRate = 0;

    let hsnSac = String(source.hsnSac ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (hsnSac.length < 2 || hsnSac.length > 20) hsnSac = "";

    items.push({
      description: description || "Item",
      hsnSac,
      quantity,
      unit: normalizeUnit(source.unit),
      unitRate: round(Math.min(rate, 1000000000), 2),
      discountPercent: round(discountPercent, 2),
      gstRate,
      amount,
      suggestedType: hsnSac.startsWith("99") || SERVICE_WORDS.test(description) ? "SERVICE" : "GOODS",
      flags,
    });
  }

  /*
   * Reconcile line GST rates with the tax the bill itself printed.
   * Many invoices show the rate only in the tax summary, so a model can guess
   * a wrong per-line rate (e.g. 18% when the bill charged 6% + 6%).
   * Works for CGST+SGST, IGST and mixed bills: only overrides when the lines'
   * implied tax does not match the printed tax AND one single rate explains it.
   */
  if (taxMode !== "NONE" && items.length && totalTax > 0) {
    const lineBase = (item) => item.quantity * item.unitRate * (1 - item.discountPercent / 100);

    const linesTaxable = items.reduce((sum, item) => sum + lineBase(item), 0);
    const base = totals.taxable > 0 ? totals.taxable : linesTaxable;
    const expectedTax = items.reduce((sum, item) => sum + (lineBase(item) * item.gstRate) / 100, 0);
    const tolerance = Math.max(1, totalTax * 0.005);

    if (base > 0 && Math.abs(expectedTax - totalTax) > tolerance) {
      const impliedRate = snapGstRate(round((totalTax / base) * 100, 2), "NONE");

      if (impliedRate !== null && impliedRate > 0) {
        let changed = false;

        for (const item of items) {
          if (item.gstRate !== impliedRate) {
            item.gstRate = impliedRate;
            item.flags.push("GST rate corrected from bill totals");
            changed = true;
          }
        }

        if (changed) {
          warnings.push(
            `Line GST rates did not match the tax printed on the bill, so ${impliedRate}% (from the bill's tax totals) was applied. Check each line.`,
          );
        }
      }
    }
  }

  if (!items.length) warnings.push("No line items were detected. Add the items manually.");

  return {
    supplier,
    invoice,
    taxMode,
    totals,
    items,
    notes: text(raw.notes, 1000),
    warnings,
  };
};

/* ---------- similarity ---------- */

const normText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normSupplierName = (value) =>
  normText(value)
    .replace(/\b(pvt|private|ltd|limited|llp|inc|opc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const bigrams = (value) => {
  const compact = value.replace(/\s+/g, "");
  const map = new Map();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    map.set(gram, (map.get(gram) || 0) + 1);
  }
  return { map, total: Math.max(compact.length - 1, 0) };
};

const dice = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const first = bigrams(a);
  const second = bigrams(b);
  if (!first.total || !second.total) return 0;

  let intersection = 0;
  for (const [gram, count] of first.map) {
    intersection += Math.min(count, second.map.get(gram) || 0);
  }

  return (2 * intersection) / (first.total + second.total);
};

const jaccard = (a, b) => {
  const first = new Set(a.split(" ").filter(Boolean));
  const second = new Set(b.split(" ").filter(Boolean));
  if (!first.size || !second.size) return 0;

  let shared = 0;
  for (const token of first) if (second.has(token)) shared += 1;

  return shared / (first.size + second.size - shared);
};

const similarity = (a, b, normalizer = normText) => {
  const x = normalizer(a);
  const y = normalizer(b);
  return Math.max(dice(x, y), jaccard(x, y));
};

module.exports = {
  GST_RATES,
  GSTIN_RE,
  normalizeExtraction,
  normText,
  normSupplierName,
  similarity,
};