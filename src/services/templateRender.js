const { createDocToken } = require("./documents/documentToken");

const money = (p) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((Number(p) || 0) / 100);

const date = (v) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A";

const isPurchase = (i) => Boolean(i.billNumber && !i.invoiceNumber);

const VARIABLES = {
  customerName: (i) => i.customerName || i.supplierName || i.vendorName || "Customer",
  invoiceNumber: (i) => i.invoiceNumber || i.billNumber,
  invoiceDate: (i) => date(i.invoiceDate || i.billDate || i.createdAt),
  dueDate: (i) => date(i.dueDate),
  totalAmount: (i) =>
    money(
      i.totalAmountPaise !== undefined
        ? i.totalAmountPaise
        : i.totalAmount
        ? Math.round(Number(i.totalAmount) * 100)
        : 0
    ),
  pendingAmount: (i) =>
    money(
      i.outstandingAmountPaise !== undefined
        ? i.outstandingAmountPaise
        : i.balanceAmount
        ? Math.round(Number(i.balanceAmount) * 100)
        : 0
    ),
  companyName: () => process.env.COMPANY_NAME || "Company",
  viewUrl: (i) => {
    try {
      const docType = isPurchase(i) ? "purchaseBill" : "invoice";
      const ref = isPurchase(i) ? i.billNumber : i.invoiceNumber;
      const token = createDocToken({
        tenantId: i.tenantId,
        docType,
        ref,
        ttlMinutes: 90 * 24 * 60,
      });
      const frontendBase = (process.env.FRONTEND_URL || "https://truebill.trustiqtech.com").replace(/\/$/, "");
      return `${frontendBase}/print/${docType}/${encodeURIComponent(token)}`;
    } catch {
      return "";
    }
  },
};

const SAMPLES = {
  customerName: "Karthik",
  invoiceNumber: "SI002",
  invoiceDate: "01 Nov 2026",
  dueDate: "01 Nov 2026",
  totalAmount: "₹66,312.22",
  pendingAmount: "₹66,312.22",
  companyName: "TrustIQ",
};

const buildValues = (invoice) =>
  Object.fromEntries(Object.entries(VARIABLES).map(([k, fn]) => [k, String(fn(invoice))]));

const keysIn = (text) => {
  const found = [];
  for (const m of String(text).matchAll(/{{\s*(\w+)\s*}}/g)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
};

const renderNamed = (text, values) =>
  String(text).replace(/{{\s*(\w+)\s*}}/g, (_, k) => values[k] ?? "");

/* {{customerName}} -> {{1}} for Meta */
const toPositional = (text, keys) =>
  String(text).replace(/{{\s*(\w+)\s*}}/g, (_, k) => `{{${keys.indexOf(k) + 1}}}`);

module.exports = { VARIABLES, SAMPLES, buildValues, keysIn, renderNamed, toPositional };
