const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

/* ------------------------------------------------------------------ */
/* CONFIG                                                              */
/* ------------------------------------------------------------------ */

// Safety cap: the report computes profit for every bill in range.
const MAX_INVOICES = 2000;

// Product.purchasePrice is used only when no purchase bill exists yet.
// true  -> stored in paise (integer, like the import scale of 100)
// false -> stored in rupees
const PRODUCT_PRICE_IS_PAISE = true;

const SORT_FIELDS = new Set([
  "invoiceDate",
  "revenuePaise",
  "profitPaise",
  "marginPercent",
]);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();
const normalizeCode = (value) => normalizeText(value).toUpperCase();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const resolveContext = (tenant) => {
  const tenantId = tenant?._id ?? tenant?.id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["SalesInvoice", "PurchaseBill", "Product"]) {
    if (!models[name]) {
      throw createError(`Tenant model ${name} is unavailable`, 500);
    }
  }

  return { models, tenantId };
};

const parseDay = (value, label, endOfDay = false) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(`${label} must use YYYY-MM-DD format`);
  }

  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`${label} is invalid`);
  }

  return date;
};

const parseRange = (startDate, endDate) => {
  const end = endDate ? parseDay(endDate, "To date", true) : new Date();

  const start = startDate
    ? parseDay(startDate, "From date")
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (start > end) throw createError("From date cannot be after To date");

  return { start, end };
};

/* ------------------------------------------------------------------ */
/* cost book: latest purchase rate on or before the invoice date       */
/* ------------------------------------------------------------------ */

const buildCostBook = async ({ models, tenantId, productIds, upTo }) => {
  const book = new Map();

  if (!productIds.length) return book;

  const rows = await models.PurchaseBill.aggregate([
    {
      $match: {
        tenantId,
        isDeleted: { $ne: true },
        status: "POSTED",
        billDate: { $lte: upTo },
        "items.productId": { $in: productIds },
      },
    },
    { $unwind: "$items" },
    { $match: { "items.productId": { $in: productIds } } },
    { $sort: { billDate: 1, _id: 1 } },
    {
      $project: {
        _id: 0,
        billNumber: 1,
        billDate: 1,
        productId: "$items.productId",
        quantity: "$items.quantity",
        taxablePaise: "$items.taxableAmountPaise",
        totalPaise: "$items.totalAmountPaise",
        taxCreditEligible: "$items.taxCreditEligible",
      },
    },
  ]);

  for (const row of rows) {
    const quantity = Number(row.quantity) || 0;
    if (quantity <= 0) continue;

    // Same valuation the stock uses: GST is a cost unless credit is claimed.
    const valuePaise = row.taxCreditEligible ? row.taxablePaise : row.totalPaise;

    const key = String(row.productId);
    const list = book.get(key) || [];

    list.push({
      date: new Date(row.billDate),
      unitCostPaise: Math.round(Number(valuePaise) / quantity),
      billNumber: row.billNumber,
    });

    book.set(key, list);
  }

  return book;
};

const pickCost = (book, key, date) => {
  const list = book.get(key);
  if (!list) return null;

  let found = null;

  for (const entry of list) {
    if (entry.date <= date) found = entry;
    else break;
  }

  return found;
};

/* ------------------------------------------------------------------ */
/* profit calculation                                                  */
/* ------------------------------------------------------------------ */

const computeProfit = async ({ models, tenantId, invoices }) => {
  const idMap = new Map();
  let latest = new Date(0);

  for (const invoice of invoices) {
    const date = new Date(invoice.invoiceDate);
    if (date > latest) latest = date;

    for (const item of invoice.items || []) {
      if (item.productType === "GOODS" && item.productId) {
        idMap.set(String(item.productId), item.productId);
      }
    }
  }

  const productIds = [...idMap.values()];

  const [book, products] = await Promise.all([
    buildCostBook({ models, tenantId, productIds, upTo: latest }),
    productIds.length
      ? models.Product.find({ tenantId, _id: { $in: productIds } })
          .select("purchasePrice")
          .lean()
      : [],
  ]);

  const productMap = new Map(products.map((p) => [String(p._id), p]));

  return invoices.map((invoice) => {
    const invoiceDate = new Date(invoice.invoiceDate);

    const lines = (invoice.items || []).map((item) => {
      const revenuePaise = Number(item.taxableAmountPaise) || 0;
      const quantity = Number(item.quantity) || 0;

      let unitCostPaise = 0;
      let costSource = "NONE";
      let costRef = null;
      let costDate = null;

      if (item.productType !== "GOODS") {
        costSource = "SERVICE";
      } else {
        const key = String(item.productId);
        const hit = pickCost(book, key, invoiceDate);

        if (hit) {
          unitCostPaise = hit.unitCostPaise;
          costSource = "PURCHASE_BILL";
          costRef = hit.billNumber;
          costDate = hit.date;
        } else {
          const price = Number(productMap.get(key)?.purchasePrice) || 0;

          if (price > 0) {
            unitCostPaise = PRODUCT_PRICE_IS_PAISE
              ? Math.round(price)
              : Math.round(price * 100);
            costSource = "PRODUCT_PRICE";
          }
        }
      }

      const costPaise = Math.round(unitCostPaise * quantity);
      const profitPaise = revenuePaise - costPaise;

      return {
        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        productType: item.productType,
        unit: item.unit,
        quantity,
        unitRatePaise: item.unitRatePaise,
        discountPercent: item.discountPercent,
        revenuePaise,
        unitCostPaise,
        costPaise,
        profitPaise,
        marginPercent: revenuePaise > 0 ? round2((profitPaise / revenuePaise) * 100) : 0,
        costSource,
        costRef,
        costDate,
      };
    });

    const revenuePaise = lines.reduce((sum, l) => sum + l.revenuePaise, 0);
    const costPaise = lines.reduce((sum, l) => sum + l.costPaise, 0);
    const profitPaise = revenuePaise - costPaise;

    return {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      customerId: invoice.customerId,
      customerCode: invoice.customerCode,
      customerName: invoice.customerName,
      itemCount: lines.length,
      revenuePaise,
      taxPaise:
        (Number(invoice.cgstAmountPaise) || 0) +
        (Number(invoice.sgstAmountPaise) || 0) +
        (Number(invoice.igstAmountPaise) || 0),
      totalAmountPaise: invoice.totalAmountPaise,
      costPaise,
      profitPaise,
      marginPercent: revenuePaise > 0 ? round2((profitPaise / revenuePaise) * 100) : 0,
      costMissing: lines.some((l) => l.costSource === "NONE"),
      lines,
    };
  });
};

/* ------------------------------------------------------------------ */
/* 1. Bill wise profit list                                            */
/* ------------------------------------------------------------------ */

const getBillProfitReport = async (args) => {
  const { models, tenantId } = resolveContext(args.tenant);
  const { start, end } = parseRange(args.startDate, args.endDate);

  const filter = {
    tenantId,
    isDeleted: false,
    status: "POSTED",
    invoiceDate: { $gte: start, $lte: end },
  };

  if (args.customerId) {
    if (!mongoose.isObjectIdOrHexString(args.customerId)) {
      throw createError("customerId must be a valid ObjectId");
    }

    filter.customerId = args.customerId;
  }

  const searchText = normalizeText(args.search);

  if (searchText) {
    const regex = { $regex: escapeRegex(searchText), $options: "i" };

    filter.$or = [
      { invoiceNumber: regex },
      { customerName: regex },
      { customerCode: regex },
    ];
  }

  const count = await models.SalesInvoice.countDocuments(filter);

  if (count > MAX_INVOICES) {
    throw createError(
      `${count} bills match. Narrow the date range to ${MAX_INVOICES} bills or fewer.`,
    );
  }

  const invoices = await models.SalesInvoice.find(filter)
    .select(
      "invoiceNumber invoiceDate status paymentStatus customerId customerCode customerName items totalAmountPaise cgstAmountPaise sgstAmountPaise igstAmountPaise",
    )
    .lean();

  const computed = await computeProfit({ models, tenantId, invoices });

  const summary = computed.reduce(
    (acc, row) => {
      acc.revenuePaise += row.revenuePaise;
      acc.costPaise += row.costPaise;
      acc.profitPaise += row.profitPaise;
      if (row.profitPaise < 0) acc.lossBills += 1;
      if (row.costMissing) acc.costMissingBills += 1;
      return acc;
    },
    {
      invoiceCount: computed.length,
      revenuePaise: 0,
      costPaise: 0,
      profitPaise: 0,
      lossBills: 0,
      costMissingBills: 0,
    },
  );

  summary.marginPercent =
    summary.revenuePaise > 0
      ? round2((summary.profitPaise / summary.revenuePaise) * 100)
      : 0;

  const sortBy = SORT_FIELDS.has(args.sortBy) ? args.sortBy : "invoiceDate";
  const direction = args.sortOrder === "asc" ? 1 : -1;

  computed.sort((a, b) => {
    const left = sortBy === "invoiceDate" ? +new Date(a[sortBy]) : a[sortBy];
    const right = sortBy === "invoiceDate" ? +new Date(b[sortBy]) : b[sortBy];

    if (left !== right) return (left - right) * direction;

    return String(b.invoiceNumber).localeCompare(String(a.invoiceNumber));
  });

  const rowsWithoutLines = computed.map(({ lines, ...row }) => row);

  if (String(args.all) === "true") {
    return {
      rows: rowsWithoutLines,
      summary,
      pagination: {
        page: 1,
        limit: rowsWithoutLines.length,
        total: rowsWithoutLines.length,
        totalPages: 1,
      },
    };
  }

  const page = Math.max(Math.floor(Number(args.page) || 1), 1);
  const limit = Math.min(Math.max(Math.floor(Number(args.limit) || 25), 1), 100);

  return {
    rows: rowsWithoutLines.slice((page - 1) * limit, page * limit),
    summary,
    pagination: {
      page,
      limit,
      total: rowsWithoutLines.length,
      totalPages: Math.max(1, Math.ceil(rowsWithoutLines.length / limit)),
    },
  };
};

/* ------------------------------------------------------------------ */
/* 2. One bill, line by line                                           */
/* ------------------------------------------------------------------ */

const getBillProfitByNumber = async ({ tenant, invoiceNumber }) => {
  const { models, tenantId } = resolveContext(tenant);

  const invoice = await models.SalesInvoice.findOne({
    tenantId,
    invoiceNumber: normalizeCode(invoiceNumber),
    isDeleted: false,
    status: { $ne: "CANCELLED" },
  }).lean();

  if (!invoice) throw createError("Sales invoice not found", 404);

  const [bill] = await computeProfit({ models, tenantId, invoices: [invoice] });

  return { bill };
};

module.exports = {
  getBillProfitReport,
  getBillProfitByNumber,
};
