const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

const GST_RATES = [0, 3, 5, 12, 18, 28];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
};

const assertObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }
};

const assertAmount = (value, fieldName = "Amount") => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${fieldName} must be a non-negative safe integer`, 409);
  }

  return value;
};

const scaledInteger = (value, scale, minimum, maximum, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw createError(`${label} is invalid`, 409);
  }

  const scaled = value * scale;
  const rounded = Math.round(scaled);

  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw createError(`${label} has too many decimal places`, 409);
  }

  return rounded;
};

const multiplyDivide = (first, second, divisor) => {
  assertAmount(first);
  assertAmount(second);

  const denominator = BigInt(divisor);

  const result = Number(
    (BigInt(first) * BigInt(second) + denominator / 2n) / denominator,
  );

  return assertAmount(result);
};

const parseDateOnly = (value, fieldName) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(`${fieldName} must use YYYY-MM-DD format`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const getCustomer = async ({ models, tenantId, customerId, session }) => {
  const customer = await models.Customer.findOne({
    _id: customerId,
    tenantId,
    isDeleted: false,
    status: "Active",
  })
    .session(session)
    .lean();

  if (!customer) {
    throw createError("Active customer not found", 404);
  }

  if (!customer.ledgerId) {
    throw createError("Customer does not have a linked receivable ledger", 409);
  }

  const ledger = await models.Ledger.findOne({
    _id: customer.ledgerId,
    tenantId,
    type: "CUSTOMER",
    nature: "ASSET",
    referenceType: "CUSTOMER",
    referenceId: customer._id,
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError("Customer receivable ledger is missing or inactive", 409);
  }

  return customer;
};

const getSalesLedger = async ({ models, tenantId, ledgerId, session }) => {
  const filter = {
    tenantId,
    isActive: true,
    nature: "INCOME",

    type: {
      $in: ["ACCOUNT", "SYSTEM"],
    },
  };

  if (ledgerId) {
    filter._id = ledgerId;
  } else {
    filter.code = "SALES";
  }

  const ledger = await models.Ledger.findOne(filter).session(session).lean();

  if (!ledger) {
    throw createError(
      "The active product sales ledger or default SALES ledger is missing",
      409,
    );
  }

  return ledger;
};

const buildInvoiceItems = async ({ models, tenantId, order, session }) => {
  if (
    !Array.isArray(order.items) ||
    order.items.length < 1 ||
    order.items.length > 200
  ) {
    throw createError(
      "The Sales Order must contain between 1 and 200 items",
      409,
    );
  }

  if (!["NONE", "INTRA_STATE", "INTER_STATE"].includes(order.taxMode)) {
    throw createError("The Sales Order tax mode is invalid", 409);
  }

  const productIds = [
    ...new Set(
      order.items.map((item) => {
        assertObjectId(item.productId, "Order productId");

        return String(item.productId);
      }),
    ),
  ];

  const products = await models.Product.find({
    _id: { $in: productIds },
    tenantId,
    isDeleted: false,
    status: "ACTIVE",
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more order products are missing or inactive",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const ledgerCache = new Map();
  const seenLineIds = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const items = [];

  for (const [index, source] of order.items.entries()) {
    const label = `Order item ${index + 1}`;

    assertObjectId(source.lineId, `${label} lineId`);

    const lineKey = String(source.lineId);

    if (seenLineIds.has(lineKey)) {
      throw createError("Sales Order line IDs must be unique", 409);
    }

    seenLineIds.add(lineKey);

    const product = productMap.get(String(source.productId));

    if (product.type !== source.productType || product.unit !== source.unit) {
      throw createError(
        `${source.productName}: product type or unit changed. Review the source order.`,
        409,
      );
    }

    const quantityMilli = scaledInteger(
      source.quantity,
      1000,
      0.001,
      1000000,
      `${label} quantity`,
    );

    const discountBasisPoints = scaledInteger(
      source.discountPercent,
      100,
      0,
      100,
      `${label} discount`,
    );

    const unitRatePaise = assertAmount(
      source.unitRatePaise,
      `${label} unit rate`,
    );

    if (unitRatePaise > 100000000000) {
      throw createError(`${label} unit rate exceeds the supported range`, 409);
    }

    if (!GST_RATES.includes(source.gstRate)) {
      throw createError(`${label} GST rate is invalid`, 409);
    }

    if (order.taxMode === "NONE" && source.gstRate !== 0) {
      throw createError(`${label} GST must be zero for No GST orders`, 409);
    }

    const grossAmountPaise = multiplyDivide(unitRatePaise, quantityMilli, 1000);

    const discountAmountPaise = multiplyDivide(
      grossAmountPaise,
      discountBasisPoints,
      10000,
    );

    const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

    const taxAmountPaise = multiplyDivide(
      taxableAmountPaise,
      source.gstRate,
      100,
    );

    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    if (order.taxMode === "INTRA_STATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);

      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (order.taxMode === "INTER_STATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const amounts = {
      grossAmountPaise,
      discountAmountPaise,
      taxableAmountPaise,
      cgstAmountPaise,
      sgstAmountPaise,
      igstAmountPaise,

      totalAmountPaise: assertAmount(taxableAmountPaise + taxAmountPaise),
    };

    for (const field of AMOUNT_FIELDS) {
      if (source[field] !== amounts[field]) {
        throw createError(
          `${label} has inconsistent ${field}. Review the source order.`,
          409,
        );
      }

      totals[field] = assertAmount(totals[field] + amounts[field]);
    }

    const ledgerKey = product.salesLedgerId
      ? String(product.salesLedgerId)
      : "DEFAULT_SALES";

    if (!ledgerCache.has(ledgerKey)) {
      const ledger = await getSalesLedger({
        models,
        tenantId,

        ledgerId: product.salesLedgerId,

        session,
      });

      ledgerCache.set(ledgerKey, ledger);
    }

    const ledger = ledgerCache.get(ledgerKey);

    items.push({
      salesOrderLineId: source.lineId,

      productId: source.productId,

      productCode: source.productCode,

      productName: source.productName,

      productType: source.productType,

      unit: source.unit,

      hsnSacCode: source.hsnSacCode || null,

      specification: source.specification || null,

      trackInventory:
        product.type === "GOODS" && Boolean(product.trackInventory),

      quantity: quantityMilli / 1000,

      unitRatePaise,

      discountPercent: discountBasisPoints / 100,

      gstRate: source.gstRate,

      salesLedgerId: ledger._id,

      ...amounts,
    });
  }

  for (const field of AMOUNT_FIELDS) {
    if (order[field] !== totals[field]) {
      throw createError(
        `Sales Order ${field} does not match its line totals`,
        409,
      );
    }
  }

  return {
    items,
    totals,
  };
};

const createInvoiceFromSalesOrder = async ({
  tenant,
  userId,
  orderNumber,
  payload = {},
  ipAddress,
}) => {
  const tenantId = tenant?._id ?? tenant?.id;

  assertObjectId(tenantId, "tenantId");

  assertObjectId(userId, "userId");

  const normalizedNumber = String(orderNumber ?? "")
    .trim()
    .toUpperCase();

  if (!normalizedNumber || normalizedNumber.length > 100) {
    throw createError("A valid Sales Order number is required");
  }

  if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
    throw createError("A valid Sales Order version is required");
  }

  const invoiceDate = parseDateOnly(payload.invoiceDate, "Invoice date");

  const dueDate = parseDateOnly(payload.dueDate, "Due date");

  if (dueDate < invoiceDate) {
    throw createError("Due date cannot be before invoice date");
  }

  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of [
    "SalesOrder",
    "SalesInvoice",
    "Customer",
    "Product",
    "Ledger",
    "AuditLog",
  ]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(
        `Tenant model ${name} is unavailable or uses the wrong connection`,
        500,
      );
    }
  }

  const { SalesOrder, SalesInvoice, AuditLog } = models;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const order = await SalesOrder.findOne({
        tenantId,

        orderNumber: normalizedNumber,

        isDeleted: false,
      })
        .session(session)
        .lean();

      if (!order) {
        throw createError("Sales Order not found", 404);
      }

      /*
       * Includes legacy unposted invoices during
       * migration, even though new records use CREATED.
       */
      const existing = await SalesInvoice.findOne({
        tenantId,

        sourceSalesOrderId: order._id,

        isDeleted: false,

        status: {
          $ne: "CANCELLED",
        },
      })
        .session(session)
        .select("invoiceNumber status")
        .lean();

      if (existing) {
        throw createError(
          `${order.orderNumber} already has invoice ${existing.invoiceNumber}`,
          409,
        );
      }

      if (!ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
        throw createError(
          "Only confirmed, in-progress, or completed Sales Orders can be invoiced",
          409,
        );
      }

      if (order.__v !== payload.version) {
        throw createError(
          "The Sales Order changed. Refresh it before creating an invoice.",
          409,
        );
      }

      const sourceOrderDate = new Date(order.orderDate);

      if (Number.isNaN(sourceOrderDate.getTime())) {
        throw createError("The source order date is invalid", 409);
      }

      if (invoiceDate < sourceOrderDate) {
        throw createError("Invoice date cannot be before the Sales Order date");
      }

      const customer = await getCustomer({
        models,
        tenantId,

        customerId: order.customerId,

        session,
      });

      const { items, totals } = await buildInvoiceItems({
        models,
        tenantId,
        order,
        session,
      });

      /*
       * Same-order concurrent requests write the same
       * source record. Transaction retries recheck
       * existing invoice and the source version.
       */
      const locked = await SalesOrder.updateOne(
        {
          _id: order._id,
          tenantId,

          isDeleted: false,

          status: order.status,

          __v: payload.version,
        },
        {
          $inc: {
            __v: 1,
          },
        },
        {
          session,
          timestamps: false,
        },
      );

      if (locked.modifiedCount !== 1) {
        throw createError(
          "The Sales Order changed. Refresh and try again.",
          409,
        );
      }

      const invoiceNumber = await getNextSequence("SI", String(tenantId), 3, {
        connection,
        session,
      });

      const records = await SalesInvoice.create(
        [
          {
            tenantId,
            invoiceNumber,

            sourceSalesOrderId: order._id,

            sourceSalesOrderNumber: order.orderNumber,

            sourceSalesOrderVersion: order.__v,

            customerId: customer._id,

            customerCode: customer.customerCode,

            customerName: customer.customerName,

            customerLedgerId: customer.ledgerId,

            customerGstNo: customer.gstNo || null,

            billingAddress: order.billingAddress || null,

            shippingAddress: order.shippingAddress || null,

            invoiceDate,
            dueDate,

            currency: "INR",

            paymentTerms: order.paymentTerms,

            deliveryTerms: order.deliveryTerms || null,

            termsAndConditions: order.termsAndConditions || null,

            taxMode: order.taxMode,

            /*
             * Dispatch owns inventory movement.
             */
            updateStock: false,

            items,
            ...totals,

            paidAmountPaise: 0,

            outstandingAmountPaise: totals.totalAmountPaise,

            paymentStatus: "UNPAID",

            status: "CREATED",

            notes: order.notes || null,

            createdBy: userId,
            updatedBy: userId,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      const invoice = records[0];

      await AuditLog.create(
        [
          {
            tenantId,
            userId,

            action: "CREATE",

            module: "SALES_INVOICE",

            documentId: invoice._id,

            oldData: null,

            newData: invoice.toObject(),

            ipAddress,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      result = invoice.toObject();
    });

    return result;
  } catch (error) {
    if (error?.code === 11000) {
      throw createError(
        "An invoice already exists for this order or an invoice-number conflict occurred. Refresh the invoice list.",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createInvoiceFromSalesOrder,
};
