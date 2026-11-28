const mongoose = require("mongoose");
const CustomerReceipt = require("../modules/customer-receipts/customerReceipt.model");
const SupplierPayment = require("../modules/supplier-payments/supplierPayment.model");
const Expense = require("../modules/accounting/Expenses/expense.model");
const SalesInvoice = require("../modules/sales-invoices/salesInvoice.model");
const Tenant = require("../models/Tenant");

/**
 * Parses or formats date boundaries (00:00:00 to 23:59:59.999)
 */
function getDayRange(dateInput) {
  let targetDate;
  if (dateInput) {
    targetDate = new Date(dateInput);
    if (isNaN(targetDate.getTime())) targetDate = new Date();
  } else {
    targetDate = new Date();
  }

  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  return {
    startOfDay,
    endOfDay,
    dateString: startOfDay.toISOString().slice(0, 10),
  };
}

/**
 * Resolves the tenantId: uses passed tenantId, or defaults to the first active tenant
 */
async function resolveTenantId(tenantId) {
  if (tenantId && mongoose.isValidObjectId(tenantId)) {
    return new mongoose.Types.ObjectId(tenantId);
  }
  const defaultTenant = await Tenant.findOne({ isActive: true }).select("_id businessName").lean();
  return defaultTenant ? defaultTenant._id : null;
}

/**
 * Calculates complete cashflow and daily sales for a tenant
 */
async function calculateCashflow({ tenantId, date } = {}) {
  const { startOfDay, endOfDay, dateString } = getDayRange(date);
  const targetTenantId = await resolveTenantId(tenantId);

  const baseFilter = {
    ...(targetTenantId ? { tenantId: targetTenantId } : {}),
  };

  // 1. Inflows: Customer Receipts
  let receiptCashPaise = 0;
  let receiptBankPaise = 0;
  let receiptTotalPaise = 0;
  let receiptCount = 0;

  try {
    const receipts = await CustomerReceipt.find({
      ...baseFilter,
      receiptDate: { $gte: startOfDay, $lte: endOfDay },
    }).lean();

    receiptCount = receipts.length;
    for (const r of receipts) {
      const paise = Number(r.amountPaise || 0);
      receiptTotalPaise += paise;
      if (r.receiptLedgerType === "CASH") {
        receiptCashPaise += paise;
      } else {
        receiptBankPaise += paise;
      }
    }
  } catch (err) {
    console.error("AI Cashflow: CustomerReceipt query error:", err.message);
  }

  // 2. Outflows: Supplier Payments
  let paymentCashPaise = 0;
  let paymentBankPaise = 0;
  let paymentTotalPaise = 0;
  let paymentCount = 0;

  try {
    const payments = await SupplierPayment.find({
      ...baseFilter,
      paymentDate: { $gte: startOfDay, $lte: endOfDay },
    }).lean();

    paymentCount = payments.length;
    for (const p of payments) {
      const paise = Number(p.amountPaise || 0);
      paymentTotalPaise += paise;
      if (p.paymentLedgerType === "CASH") {
        paymentCashPaise += paise;
      } else {
        paymentBankPaise += paise;
      }
    }
  } catch (err) {
    console.error("AI Cashflow: SupplierPayment query error:", err.message);
  }

  // 3. Outflows: Expenses
  let expenseTotalPaise = 0;
  let expenseCount = 0;

  try {
    const expenses = await Expense.find({
      ...baseFilter,
      expenseDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: "cancelled" },
    }).lean();

    expenseCount = expenses.length;
    for (const exp of expenses) {
      expenseTotalPaise += Number(exp.totalAmountPaise || exp.totalPaise || 0);
    }
  } catch (err) {
    console.error("AI Cashflow: Expense query error:", err.message);
  }

  // 4. Sales Invoices today
  let salesTotalPaise = 0;
  let salesCount = 0;
  try {
    const invoices = await SalesInvoice.find({
      ...baseFilter,
      invoiceDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: "cancelled" },
    }).lean();

    salesCount = invoices.length;
    for (const inv of invoices) {
      salesTotalPaise += Number(inv.totalAmountPaise || 0);
    }
  } catch (err) {
    console.error("AI Cashflow: SalesInvoice query error:", err.message);
  }

  // Convert Paise to INR Rupees
  const totalInflowRupees = receiptTotalPaise / 100;
  const totalOutflowRupees = (paymentTotalPaise + expenseTotalPaise) / 100;
  const netCashflowRupees = totalInflowRupees - totalOutflowRupees;
  const totalSalesRupees = salesTotalPaise / 100;

  const cashInflowRupees = receiptCashPaise / 100;
  const bankInflowRupees = receiptBankPaise / 100;
  const supplierPaymentRupees = paymentTotalPaise / 100;
  const expenseRupees = expenseTotalPaise / 100;

  const isPositive = netCashflowRupees >= 0;
  const statusEmoji = isPositive ? "🟢" : "🔴";
  const trend = isPositive ? "Positive Surplus" : "Net Deficit";

  // Pre-formatted WhatsApp text
  const whatsappMessage = [
    `📊 *Cash Flow Summary (${dateString})*`,
    ``,
    `📥 *Total Inflow:* ₹${totalInflowRupees.toLocaleString("en-IN")}`,
    `   • Cash: ₹${cashInflowRupees.toLocaleString("en-IN")}`,
    `   • Bank / UPI: ₹${bankInflowRupees.toLocaleString("en-IN")}`,
    `   • Receipts Count: ${receiptCount}`,
    ``,
    `📤 *Total Outflow:* ₹${totalOutflowRupees.toLocaleString("en-IN")}`,
    `   • Supplier Payments: ₹${supplierPaymentRupees.toLocaleString("en-IN")} (${paymentCount})`,
    `   • Expenses: ₹${expenseRupees.toLocaleString("en-IN")} (${expenseCount})`,
    ``,
    `${statusEmoji} *Net Cash Flow:* ₹${netCashflowRupees.toLocaleString("en-IN")}`,
    `Status: *${trend}*`,
    ``,
    `🧾 *Today's Total Sales:* ₹${totalSalesRupees.toLocaleString("en-IN")} (${salesCount} invoices)`,
  ].join("\n");

  return {
    date: dateString,
    inflow: {
      total: totalInflowRupees,
      cash: cashInflowRupees,
      bank: bankInflowRupees,
      receiptCount,
    },
    outflow: {
      total: totalOutflowRupees,
      supplierPayments: supplierPaymentRupees,
      expenses: expenseRupees,
      paymentCount,
      expenseCount,
    },
    netCashflow: netCashflowRupees,
    sales: {
      total: totalSalesRupees,
      invoiceCount: salesCount,
    },
    status: trend,
    whatsappMessage,
  };
}

module.exports = {
  calculateCashflow,
  getDayRange,
};
