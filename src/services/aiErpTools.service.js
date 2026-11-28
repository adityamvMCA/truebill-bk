const mongoose = require("mongoose");
const SalesInvoice = require("../modules/sales-invoices/salesInvoice.model");
const PurchaseBill = require("../modules/purchase-bills/purchaseBill.model");
const Product = require("../modules/products/product.model");
const Customer = require("../modules/customers/customer.model");
const Supplier = require("../modules/suppliers/supplier.model");
const SupplierPayment = require("../modules/supplier-payments/supplierPayment.model");
const CustomerReceipt = require("../modules/customer-receipts/customerReceipt.model");
const { calculateCashflow } = require("./aiCashflow.service");

function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 1. Customer Outstanding Balance
 */
async function getCustomerOutstanding({ tenantId, customerName }) {
  const baseMatch = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
    paymentStatus: { $ne: "PAID" },
    status: { $ne: "cancelled" },
  };

  if (customerName) {
    baseMatch.customerName = new RegExp(escapeRegex(customerName), "i");
  }

  const invoices = await SalesInvoice.find(baseMatch)
    .select("invoiceNumber customerName customerCode invoiceDate totalAmountPaise paidAmountPaise paymentStatus")
    .sort({ invoiceDate: -1 })
    .lean();

  if (customerName && invoices.length > 0) {
    let totalOutstandingPaise = 0;
    const unpaidList = [];

    for (const inv of invoices) {
      const balance = Number(inv.totalAmountPaise || 0) - Number(inv.paidAmountPaise || 0);
      if (balance > 0) {
        totalOutstandingPaise += balance;
        unpaidList.push({
          invoiceNumber: inv.invoiceNumber,
          date: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0, 10) : "-",
          balanceRupees: balance / 100,
        });
      }
    }

    const matchedCustomerName = invoices[0].customerName;
    const totalRupees = totalOutstandingPaise / 100;

    return {
      found: true,
      customerName: matchedCustomerName,
      totalOutstanding: totalRupees,
      unpaidInvoicesCount: unpaidList.length,
      unpaidInvoices: unpaidList.slice(0, 5),
      summary: `Customer *${matchedCustomerName}* has a total outstanding of *₹${totalRupees.toLocaleString("en-IN")}* across ${unpaidList.length} invoice(s).`,
    };
  }

  const grouped = await SalesInvoice.aggregate([
    { $match: baseMatch },
    {
      $project: {
        customerName: 1,
        balancePaise: { $subtract: ["$totalAmountPaise", { $ifNull: ["$paidAmountPaise", 0] }] },
      },
    },
    {
      $group: {
        _id: "$customerName",
        totalDuePaise: { $sum: "$balancePaise" },
        invoiceCount: { $sum: 1 },
      },
    },
    { $sort: { totalDuePaise: -1 } },
    { $limit: 10 },
  ]);

  let grandTotalDuePaise = 0;
  const topDebtors = grouped.map((g) => {
    grandTotalDuePaise += g.totalDuePaise;
    return {
      customerName: g._id,
      amountRupees: g.totalDuePaise / 100,
      invoiceCount: g.invoiceCount,
    };
  });

  return {
    found: topDebtors.length > 0,
    totalReceivable: grandTotalDuePaise / 100,
    topCustomers: topDebtors,
    summary: `Total Outstanding Receivables from Customers: *₹${(grandTotalDuePaise / 100).toLocaleString("en-IN")}* across ${topDebtors.length} key customers.`,
  };
}

/**
 * 2. Supplier Outstanding Balance (Payables)
 */
async function getSupplierOutstanding({ tenantId, supplierName }) {
  const baseMatch = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
    paymentStatus: { $nin: ["PAID", "SETTLED"] },
    status: { $ne: "cancelled" },
  };

  if (supplierName) {
    baseMatch.supplierName = new RegExp(escapeRegex(supplierName), "i");
  }

  const bills = await PurchaseBill.find(baseMatch)
    .select("billNumber supplierName supplierCode billDate totalAmountPaise paidAmountPaise paymentStatus")
    .sort({ billDate: -1 })
    .lean();

  if (supplierName && bills.length > 0) {
    let totalDuePaise = 0;
    const unpaidList = [];

    for (const b of bills) {
      const balance = Number(b.totalAmountPaise || 0) - Number(b.paidAmountPaise || 0);
      if (balance > 0) {
        totalDuePaise += balance;
        unpaidList.push({
          billNumber: b.billNumber,
          date: b.billDate ? new Date(b.billDate).toISOString().slice(0, 10) : "-",
          balanceRupees: balance / 100,
        });
      }
    }

    const matchedSupplierName = bills[0].supplierName;
    const totalRupees = totalDuePaise / 100;

    return {
      found: true,
      supplierName: matchedSupplierName,
      totalOutstanding: totalRupees,
      unpaidBillsCount: unpaidList.length,
      unpaidBills: unpaidList.slice(0, 5),
      summary: `You owe Supplier *${matchedSupplierName}* a total of *₹${totalRupees.toLocaleString("en-IN")}* across ${unpaidList.length} bill(s).`,
    };
  }

  const grouped = await PurchaseBill.aggregate([
    { $match: baseMatch },
    {
      $project: {
        supplierName: 1,
        balancePaise: { $subtract: ["$totalAmountPaise", { $ifNull: ["$paidAmountPaise", 0] }] },
      },
    },
    {
      $group: {
        _id: "$supplierName",
        totalDuePaise: { $sum: "$balancePaise" },
        billCount: { $sum: 1 },
      },
    },
    { $sort: { totalDuePaise: -1 } },
    { $limit: 10 },
  ]);

  let grandTotalDuePaise = 0;
  const topPayables = grouped.map((g) => {
    grandTotalDuePaise += g.totalDuePaise;
    return {
      supplierName: g._id,
      amountRupees: g.totalDuePaise / 100,
      billCount: g.billCount,
    };
  });

  return {
    found: topPayables.length > 0,
    totalPayable: grandTotalDuePaise / 100,
    topSuppliers: topPayables,
    summary: `Total Outstanding Payables to Suppliers: *₹${(grandTotalDuePaise / 100).toLocaleString("en-IN")}*.`,
  };
}

/**
 * 3. Low Stock Alerts
 */
async function getLowStockItems({ tenantId }) {
  const products = await Product.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    trackInventory: true,
    $expr: {
      $lte: ["$currentStock", { $ifNull: ["$reorderLevel", 5] }],
    },
  })
    .select("name productCode currentStock reorderLevel unit salePrice")
    .sort({ currentStock: 1 })
    .limit(15)
    .lean();

  const items = products.map((p) => ({
    name: p.name,
    code: p.productCode,
    stock: p.currentStock || 0,
    reorderLevel: p.reorderLevel || 0,
    unit: p.unit || "NOS",
  }));

  return {
    count: items.length,
    items,
    summary:
      items.length > 0
        ? `⚠️ Found *${items.length}* item(s) running low on stock!`
        : `✅ All items have healthy stock levels. No low stock alerts right now.`,
  };
}

/**
 * 4. Specific Product Stock Check
 */
async function getProductStock({ tenantId, productName }) {
  if (!productName) return { found: false, message: "Please specify a product name." };

  const products = await Product.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    name: new RegExp(escapeRegex(productName), "i"),
  })
    .select("name productCode currentStock reorderLevel unit salePrice purchasePrice")
    .limit(5)
    .lean();

  if (!products || products.length === 0) {
    return { found: false, summary: `No product found matching "${productName}".` };
  }

  const items = products.map((p) => ({
    name: p.name,
    stock: p.currentStock || 0,
    unit: p.unit || "NOS",
    price: p.salePrice || 0,
  }));

  return {
    found: true,
    items,
    summary: items
      .map((i) => `📦 *${i.name}*: Current Stock = *${i.stock} ${i.unit}* (Price: ₹${i.price})`)
      .join("\n"),
  };
}

/**
 * 5. Vendor / Customer Complete Information & Last Paid Amount
 */
async function getPartyDetails({ tenantId, name }) {
  if (!name) return { found: false, summary: "Please specify a customer or vendor name." };

  const tenantObjectId = new mongoose.Types.ObjectId(tenantId);
  const regex = new RegExp(escapeRegex(name.trim()), "i");

  // 1. Check Supplier (Vendor) first
  const supplier = await Supplier.findOne({
    tenantId: tenantObjectId,
    supplierName: regex,
  }).lean();

  if (supplier) {
    const lastPayment = await SupplierPayment.findOne({
      tenantId: tenantObjectId,
      $or: [{ supplierId: supplier._id }, { supplierName: regex }],
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    const unpaidBills = await PurchaseBill.find({
      tenantId: tenantObjectId,
      $or: [{ supplierId: supplier._id }, { supplierName: regex }],
      paymentStatus: { $nin: ["PAID", "SETTLED"] },
      status: { $ne: "cancelled" },
    }).lean();

    let totalDuePaise = 0;
    for (const b of unpaidBills) {
      totalDuePaise += Number(b.totalAmountPaise || 0) - Number(b.paidAmountPaise || 0);
    }

    const lastPaidRupees = lastPayment ? Number(lastPayment.amountPaise || 0) / 100 : 0;
    const lastPaidDate = lastPayment?.paymentDate
      ? new Date(lastPayment.paymentDate).toISOString().slice(0, 10)
      : null;

    const summaryLines = [
      `🏭 *Vendor / Supplier Profile: ${supplier.supplierName}*`,
      supplier.contactPerson ? `• *Contact:* ${supplier.contactPerson}` : null,
      supplier.phone ? `• *Phone:* ${supplier.phone}` : null,
      supplier.email ? `• *Email:* ${supplier.email}` : null,
      supplier.gstNo ? `• *GSTIN:* ${supplier.gstNo}` : null,
      supplier.city ? `• *Location:* ${supplier.city}${supplier.state ? ", " + supplier.state : ""}` : null,
      ``,
      `💰 *Total Amount We Owe:* ₹${(totalDuePaise / 100).toLocaleString("en-IN")}`,
      lastPayment
        ? `💸 *Last Paid Amount:* ₹${lastPaidRupees.toLocaleString("en-IN")} on ${lastPaidDate} (via ${lastPayment.paymentMethod || "Bank"})`
        : `💸 *Last Paid Amount:* No previous payment recorded.`,
      `📄 *Pending Bills:* ${unpaidBills.length}`,
    ].filter(Boolean);

    return {
      found: true,
      type: "SUPPLIER",
      name: supplier.supplierName,
      phone: supplier.phone,
      gstNo: supplier.gstNo,
      outstandingDue: totalDuePaise / 100,
      lastPayment: lastPayment
        ? {
            amount: lastPaidRupees,
            date: lastPaidDate,
            method: lastPayment.paymentMethod,
            number: lastPayment.paymentNumber,
          }
        : null,
      summary: summaryLines.join("\n"),
    };
  }

  // 2. Check Customer
  const customer = await Customer.findOne({
    tenantId: tenantObjectId,
    customerName: regex,
  }).lean();

  if (customer) {
    const lastReceipt = await CustomerReceipt.findOne({
      tenantId: tenantObjectId,
      $or: [{ customerId: customer._id }, { customerName: regex }],
    })
      .sort({ receiptDate: -1, createdAt: -1 })
      .lean();

    const unpaidInvoices = await SalesInvoice.find({
      tenantId: tenantObjectId,
      $or: [{ customerId: customer._id }, { customerName: regex }],
      paymentStatus: { $ne: "PAID" },
      status: { $ne: "cancelled" },
    }).lean();

    let totalDuePaise = 0;
    for (const inv of unpaidInvoices) {
      totalDuePaise += Number(inv.totalAmountPaise || 0) - Number(inv.paidAmountPaise || 0);
    }

    const lastReceivedRupees = lastReceipt ? Number(lastReceipt.amountPaise || 0) / 100 : 0;
    const lastReceiptDate = lastReceipt?.receiptDate
      ? new Date(lastReceipt.receiptDate).toISOString().slice(0, 10)
      : null;

    const summaryLines = [
      `👤 *Customer Profile: ${customer.customerName}*`,
      customer.contactPerson ? `• *Contact:* ${customer.contactPerson}` : null,
      customer.phone ? `• *Phone:* ${customer.phone}` : null,
      customer.email ? `• *Email:* ${customer.email}` : null,
      customer.gstNo ? `• *GSTIN:* ${customer.gstNo}` : null,
      customer.city ? `• *Location:* ${customer.city}${customer.state ? ", " + customer.state : ""}` : null,
      ``,
      `💰 *Total Outstanding Balance:* ₹${(totalDuePaise / 100).toLocaleString("en-IN")}`,
      lastReceipt
        ? `📥 *Last Paid by Customer:* ₹${lastReceivedRupees.toLocaleString("en-IN")} on ${lastReceiptDate} (via ${lastReceipt.receiptMethod || "Bank"})`
        : `📥 *Last Paid by Customer:* No previous receipt recorded.`,
      `📄 *Unpaid Invoices:* ${unpaidInvoices.length}`,
    ].filter(Boolean);

    return {
      found: true,
      type: "CUSTOMER",
      name: customer.customerName,
      phone: customer.phone,
      gstNo: customer.gstNo,
      outstandingDue: totalDuePaise / 100,
      lastPayment: lastReceipt
        ? {
            amount: lastReceivedRupees,
            date: lastReceiptDate,
            method: lastReceipt.receiptMethod,
            number: lastReceipt.receiptNumber,
          }
        : null,
      summary: summaryLines.join("\n"),
    };
  }

  return {
    found: false,
    summary: `No vendor or customer found matching "${name}".`,
  };
}

module.exports = {
  getCustomerOutstanding,
  getSupplierOutstanding,
  getLowStockItems,
  getProductStock,
  getPartyDetails,
  calculateCashflow,
};
