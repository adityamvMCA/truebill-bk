
export {
  GST_RATES,
  formatPaise,
  getErrors,
  loadAllPages,
  localDate,
} from "../purchase-bills/purchaseBill.utils";

export const PAYMENT_MODES = [
  { value: "PAID", label: "Paid now (cash / bank)" },
  { value: "PAYABLE", label: "Pay later (supplier payable)" },
];

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "UPI", label: "UPI" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CARD", label: "Card" },
];

export const EXPENSE_TAX_OPTIONS = [
  { value: "NONE", label: "No GST" },
  { value: "GST", label: "GST (input credit)" },
];

export const STATUS_LABELS = {
  NEW: "New",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const EMPTY_EXPENSE_TOTALS = { taxable: 0, tax: 0, total: 0 };

// Preview only - the server calculates the final amounts.
export const calculateExpenseLine = (line, taxMode) => {
  const amount = Number(line.amount);
  const rate = taxMode === "GST" ? Number(line.gstRate) : 0;

  const valid =
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 1000000000 &&
    Number.isFinite(rate) &&
    rate >= 0;

  if (!valid) return { valid: false, taxable: 0, tax: 0, total: 0 };

  const taxable = Math.round(amount * 100);
  const tax = Math.round((taxable * rate) / 100);

  return { valid: true, taxable, tax, total: taxable + tax };
};

export const newRequestId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const random = (Math.random() * 16) | 0;
        return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
      });
