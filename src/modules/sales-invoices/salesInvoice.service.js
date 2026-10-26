const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");
const { isEwayBillRequired } = require("./ewayBill/ewayBill.rules");
const {
  postJournal,
  rupeesToPaise,
  paiseToRupees,
} = require("../accounting/journals/journal.service");

const stockMovementService = require("../stock-movements/stockMovement.service");

const NotificationService = require("../../services/notificationService");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const INVOICE_STATUSES = ["CREATED", "POSTED", "CANCELLED"];

const ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];

const TAX_MODES = ["NONE", "INTRA_STATE", "INTER_STATE"];

const GST_RATES = [0, 3, 5, 12, 18, 28];

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

/* ==========================================
   SHARED HELPERS
   ========================================== */

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;

  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const normalizeOptionalText = (value) => normalizeText(value) || null;

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return value;
};

const assertSafeAmount = (value, fieldName = "Amount") => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${fieldName} exceeds the supported range`);
  }

  return value;
};

const addAmounts = (first, second) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  return assertSafeAmount(first + second);
};

const multiplyDivide = (first, second, divisor) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw createError("Invalid calculation divisor");
  }

  const numerator = BigInt(first) * BigInt(second);

  const denominator = BigInt(divisor);

  const rounded = (numerator + denominator / 2n) / denominator;

  return assertSafeAmount(Number(rounded));
};

const scaledNumber = ({ value, scale, minimum, maximum, fieldName }) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw createError(`${fieldName} must be between ${minimum} and ${maximum}`);
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
    throw createError(`${fieldName} has too many decimal places`);
  }

  return integer;
};

const parseDate = (value, fieldName) => {
  if (!value || !(typeof value === "string" || value instanceof Date)) {
    throw createError(`${fieldName} is required`);
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw createError(`${fieldName} is invalid`);
    }

    return date;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertVersion = (document, version, label) => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError(`A valid ${label} version is required`);
  }

  if (document.__v !== version) {
    throw createError(`${label} changed. Refresh before continuing.`, 409);
  }
};

const translateError = (error) => {
  if (error?.code === 11000) {
    return createError(
      "An invoice number or active Sales Order invoice already exists. Refresh the invoice list.",
      409,
    );
  }

  if (error?.name === "VersionError") {
    return createError("The invoice changed. Refresh before continuing.", 409);
  }

  return error;
};

const resolveContext = ({ tenant, ...args }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  validateObjectId(tenantId, "tenantId");

  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of [
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

  return {
    ...args,
    tenant,
    tenantId,
    connection,
    models,
  };
};

const requireOrderModel = (context) => {
  if (
    !context.models.SalesOrder ||
    context.models.SalesOrder.db !== context.connection
  ) {
    throw createError("SalesOrder tenant model is unavailable", 500);
  }
};

const runTransaction = async (args, operation) => {
  const context = resolveContext(args);

  validateObjectId(context.userId, "userId");

  const session = await context.connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({
        ...context,
        session,
      });
    });

    return result;
  } catch (error) {
    throw translateError(error);
  } finally {
    await session.endSession();
  }
};

/* ==========================================
   CUSTOMER AND LEDGERS
   ========================================== */

const getCustomer = async ({ models, tenantId, customerId, session }) => {
  validateObjectId(customerId, "customerId");

  const customer = await models.Customer.findOne({
    _id: customerId,
    tenantId,
    isDeleted: false,
    status: "Active",
  }).session(session);

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
    throw createError(
      "The customer receivable ledger is missing or inactive",
      409,
    );
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
      ledgerId
        ? "The product sales ledger is missing or inactive"
        : "The active SALES ledger is missing. Seed accounting ledgers first.",
      409,
    );
  }

  return ledger;
};

const getOutputTaxLedger = async ({ models, tenantId, code, session }) => {
  const ledger = await models.Ledger.findOne({
    tenantId,
    code,
    type: "TAX",
    nature: "LIABILITY",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(`Active ${code} output tax ledger is missing`, 409);
  }

  return ledger;
};

/* ==========================================
   CALCULATE INVOICE

   sourceOrder is backend-only.
   Never obtain it directly from request data.
   ========================================== */

const calculateInvoice = async ({
  models,
  tenantId,
  payload,
  sourceOrder = null,
  session,
}) => {
  const customer = await getCustomer({
    models,
    tenantId,
    customerId: payload.customerId,
    session,
  });

  const invoiceDate = parseDate(payload.invoiceDate, "Invoice date");

  const dueDate = parseDate(payload.dueDate, "Due date");

  if (dueDate < invoiceDate) {
    throw createError("Due date cannot be before invoice date");
  }

  if (!TAX_MODES.includes(payload.taxMode)) {
    throw createError("Invalid taxMode");
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("An invoice requires between 1 and 200 items");
  }

  if (
    typeof payload.updateStock !== "undefined" &&
    typeof payload.updateStock !== "boolean"
  ) {
    throw createError("updateStock must be a boolean");
  }

  if (sourceOrder && String(customer._id) !== String(sourceOrder.customerId)) {
    throw createError("Invoice customer must match the Sales Order", 409);
  }

  const requestedProductIds = payload.items.map((item) => {
    validateObjectId(item.productId, "productId");

    return String(item.productId).toLowerCase();
  });

  const productIds = [...new Set(requestedProductIds)];

  if (!sourceOrder && productIds.length !== requestedProductIds.length) {
    throw createError("A product can appear only once in a direct invoice");
  }

  const products = await models.Product.find({
    _id: {
      $in: productIds,
    },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more products are missing, inactive, or belong to another tenant",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id).toLowerCase(), product]),
  );

  const ledgerCache = new Map();
  const seenSourceLineIds = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const items = [];

  for (const [index, input] of payload.items.entries()) {
    const product = productMap.get(String(input.productId).toLowerCase());

    const sourceLine = sourceOrder?.items[index] || null;

    const label = `Item ${index + 1}`;

    if (sourceOrder) {
      if (
        !sourceLine ||
        String(sourceLine.productId).toLowerCase() !==
          String(input.productId).toLowerCase()
      ) {
        throw createError(`${label} does not match the source order`, 409);
      }

      validateObjectId(sourceLine.lineId, `${label} Sales Order lineId`);

      const lineKey = String(sourceLine.lineId);

      if (seenSourceLineIds.has(lineKey)) {
        throw createError("Sales Order line IDs must be unique", 409);
      }

      seenSourceLineIds.add(lineKey);

      if (
        product.unit !== sourceLine.unit ||
        product.type !== sourceLine.productType
      ) {
        throw createError(
          `${sourceLine.productName}: product type or unit changed. Review the source order.`,
          409,
        );
      }
    }

    const quantityMilli = scaledNumber({
      value: input.quantity,
      scale: 1000,
      minimum: 0.001,
      maximum: 1000000,
      fieldName: `${label} quantity`,
    });

    const discountBasisPoints = scaledNumber({
      value: input.discountPercent ?? 0,
      scale: 100,
      minimum: 0,
      maximum: 100,
      fieldName: `${label} discount`,
    });

    let unitRatePaise;

    if (sourceOrder) {
      unitRatePaise = assertSafeAmount(
        sourceLine.unitRatePaise,
        `${label} unit rate`,
      );

      if (unitRatePaise > 100000000000) {
        throw createError(`${label} unit rate exceeds the supported range`);
      }
    } else {
      if (
        typeof input.unitRate !== "number" ||
        !Number.isFinite(input.unitRate) ||
        input.unitRate < 0 ||
        input.unitRate > 1000000000
      ) {
        throw createError(`${label} unit rate is invalid`);
      }

      unitRatePaise = rupeesToPaise(input.unitRate, `${label} unit rate`);
    }

    const gstRate = input.gstRate ?? product.gstRate;

    if (!GST_RATES.includes(gstRate)) {
      throw createError(`${label} GST rate is invalid`);
    }

    if (payload.taxMode === "NONE" && gstRate !== 0) {
      throw createError(`${label} GST must be zero when taxMode is NONE`);
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

    const salesLedger = ledgerCache.get(ledgerKey);

    const grossAmountPaise = multiplyDivide(unitRatePaise, quantityMilli, 1000);

    const discountAmountPaise = multiplyDivide(
      grossAmountPaise,
      discountBasisPoints,
      10000,
    );

    const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

    const taxAmountPaise = multiplyDivide(taxableAmountPaise, gstRate, 100);

    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    if (payload.taxMode === "INTRA_STATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);

      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (payload.taxMode === "INTER_STATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const item = {
      productId: product._id,

      productCode: sourceLine?.productCode ?? product.productCode,

      productName: sourceLine?.productName ?? product.name,

      productType: sourceLine?.productType ?? product.type,

      unit: sourceLine?.unit ?? product.unit,

      hsnSacCode: sourceLine
        ? sourceLine.hsnSacCode || null
        : product.hsnSacCode || null,

      salesOrderLineId: sourceLine?.lineId || null,

      specification: normalizeOptionalText(sourceLine?.specification),

      trackInventory:
        product.type === "GOODS" && Boolean(product.trackInventory),

      quantity: quantityMilli / 1000,

      unitRatePaise,

      discountPercent: discountBasisPoints / 100,

      gstRate,

      salesLedgerId: salesLedger._id,

      grossAmountPaise,
      discountAmountPaise,
      taxableAmountPaise,
      cgstAmountPaise,
      sgstAmountPaise,
      igstAmountPaise,

      totalAmountPaise: addAmounts(taxableAmountPaise, taxAmountPaise),
    };

    for (const field of AMOUNT_FIELDS) {
      if (sourceLine && sourceLine[field] !== item[field]) {
        throw createError(
          `${label} ${field} does not match the source order`,
          409,
        );
      }

      totals[field] = addAmounts(totals[field], item[field]);
    }

    items.push(item);
  }

  if (sourceOrder) {
    for (const field of AMOUNT_FIELDS) {
      if (sourceOrder[field] !== totals[field]) {
        throw createError(
          `Invoice ${field} does not match the Sales Order`,
          409,
        );
      }
    }
  }

  return {
    customerId: customer._id,

    customerCode: customer.customerCode,

    customerName: customer.customerName,

    customerLedgerId: customer.ledgerId,

    customerGstNo: customer.gstNo || null,

    invoiceDate,
    dueDate,

    currency: "INR",

    paymentTerms:
      normalizeText(payload.paymentTerms) ||
      customer.paymentTerms ||
      "Due on Receipt",

    taxMode: payload.taxMode,

    updateStock: sourceOrder ? false : (payload.updateStock ?? false),

    items,
    ...totals,

    paidAmountPaise: 0,
    ewayBillRequired: isEwayBillRequired({ items }),
    outstandingAmountPaise: totals.totalAmountPaise,

    paymentStatus: "UNPAID",

    notes: normalizeOptionalText(payload.notes),

    ...(sourceOrder
      ? {
          sourceSalesOrderId: sourceOrder._id,

          sourceSalesOrderNumber: sourceOrder.orderNumber,

          sourceSalesOrderVersion: sourceOrder.__v,

          billingAddress: normalizeOptionalText(sourceOrder.billingAddress),

          shippingAddress: normalizeOptionalText(sourceOrder.shippingAddress),

          deliveryTerms: normalizeOptionalText(sourceOrder.deliveryTerms),

          termsAndConditions: normalizeOptionalText(
            sourceOrder.termsAndConditions,
          ),
        }
      : {}),
  };
};

/* ==========================================
   LOAD / AUDIT
   ========================================== */

const getCreatedForUpdate = async ({
  models,
  tenantId,
  invoiceNumber,
  session,
}) => {
  const invoice = await models.SalesInvoice.findOne({
    tenantId,

    invoiceNumber: normalizeCode(invoiceNumber),

    isDeleted: false,
  }).session(session);

  if (!invoice) {
    throw createError("Sales invoice not found", 404);
  }

  if (invoice.status !== "CREATED") {
    throw createError(
      "Only created sales invoices can be edited, posted, or deleted",
      409,
    );
  }

  return invoice;
};

const createAudit = async ({
  models,
  tenantId,
  userId,
  action,
  invoice,
  oldData = null,
  ipAddress,
  session,
}) => {
  await models.AuditLog.create(
    [
      {
        tenantId,
        userId,
        action,
        module: "SALES_INVOICE",

        documentId: invoice._id,

        oldData,

        newData: invoice.toObject(),

        ipAddress,
      },
    ],
    {
      session,
      ordered: true,
    },
  );
};

/* ==========================================
   ORDER-LINKED INVOICE CHECKS
   ========================================== */

const ensureNoOrderInvoice = async ({
  models,
  tenantId,
  orderId,
  excludeInvoiceId,
  session,
}) => {
  const filter = {
    tenantId,

    sourceSalesOrderId: orderId,

    isDeleted: false,

    status: {
      $ne: "CANCELLED",
    },
  };

  if (excludeInvoiceId) {
    filter._id = {
      $ne: excludeInvoiceId,
    };
  }

  const existing = await models.SalesInvoice.findOne(filter)
    .session(session)
    .select("invoiceNumber status")
    .lean();

  if (existing) {
    throw createError(
      `This Sales Order already has invoice ${existing.invoiceNumber}`,
      409,
    );
  }
};

const validateLinkedSalesOrder = async (context) => {
  const { models, tenantId, invoice, session } = context;

  if (!invoice.sourceSalesOrderId) {
    return;
  }

  requireOrderModel(context);

  if (invoice.updateStock !== false) {
    throw createError(
      "Order-linked invoices cannot deduct stock. Use Delivery Note dispatch.",
      409,
    );
  }

  const order = await models.SalesOrder.findOne({
    _id: invoice.sourceSalesOrderId,

    tenantId,
    isDeleted: false,

    status: {
      $in: ELIGIBLE_ORDER_STATUSES,
    },
  })
    .session(session)
    .lean();

  if (!order) {
    throw createError(
      "The source Sales Order is unavailable or cancelled",
      409,
    );
  }

  if (String(order.customerId) !== String(invoice.customerId)) {
    throw createError(
      "Invoice customer does not match the source Sales Order",
      409,
    );
  }

  if (
    order.taxMode !== invoice.taxMode ||
    order.items.length !== invoice.items.length
  ) {
    throw createError(
      "Invoice lines or tax mode do not match the source Sales Order",
      409,
    );
  }

  const orderLines = new Map(
    order.items.map((item) => [String(item.lineId), item]),
  );

  const seen = new Set();

  for (const item of invoice.items) {
    const key = String(item.salesOrderLineId);

    const source = orderLines.get(key);

    if (
      !source ||
      seen.has(key) ||
      String(source.productId) !== String(item.productId)
    ) {
      throw createError(
        "Invoice contains invalid Sales Order line references",
        409,
      );
    }

    seen.add(key);

    for (const field of [
      "quantity",
      "unitRatePaise",
      "discountPercent",
      "gstRate",
      "unit",
      "productType",
      ...AMOUNT_FIELDS,
    ]) {
      if (source[field] !== item[field]) {
        throw createError(
          `Invoice line ${field} no longer matches the Sales Order`,
          409,
        );
      }
    }
  }

  for (const field of AMOUNT_FIELDS) {
    if (order[field] !== invoice[field]) {
      throw createError(`Invoice ${field} does not match the Sales Order`, 409);
    }
  }

  await ensureNoOrderInvoice({
    models,
    tenantId,
    orderId: order._id,
    excludeInvoiceId: invoice._id,
    session,
  });

  /*
   * Prevent the source order changing concurrently
   * with this posting transaction.
   */
  const locked = await models.SalesOrder.updateOne(
    {
      _id: order._id,
      tenantId,
      isDeleted: false,
      status: order.status,
      __v: order.__v,
    },
    {
      $inc: { __v: 1 },
    },
    {
      session,
      timestamps: false,
    },
  );

  if (locked.modifiedCount !== 1) {
    throw createError("The Sales Order changed. Refresh before posting.", 409);
  }
};

/* ==========================================
   JOURNAL AND POSTING
   ========================================== */

const buildJournalLines = async ({ models, tenantId, invoice, session }) => {
  const incomeAmounts = new Map();

  const outputTaxes = {
    OUTPUT_CGST: 0,
    OUTPUT_SGST: 0,
    OUTPUT_IGST: 0,
  };

  for (const item of invoice.items) {
    const ledgerId = String(item.salesLedgerId);

    incomeAmounts.set(
      ledgerId,
      addAmounts(incomeAmounts.get(ledgerId) || 0, item.taxableAmountPaise),
    );

    outputTaxes.OUTPUT_CGST = addAmounts(
      outputTaxes.OUTPUT_CGST,
      item.cgstAmountPaise,
    );

    outputTaxes.OUTPUT_SGST = addAmounts(
      outputTaxes.OUTPUT_SGST,
      item.sgstAmountPaise,
    );

    outputTaxes.OUTPUT_IGST = addAmounts(
      outputTaxes.OUTPUT_IGST,
      item.igstAmountPaise,
    );
  }

  const lines = [];

  for (const [ledgerId, amount] of incomeAmounts) {
    if (!amount) continue;

    await getSalesLedger({
      models,
      tenantId,
      ledgerId,
      session,
    });

    lines.push({
      ledgerId,
      debitPaise: 0,
      creditPaise: amount,
    });
  }

  for (const [code, amount] of Object.entries(outputTaxes)) {
    if (!amount) continue;

    const ledger = await getOutputTaxLedger({
      models,
      tenantId,
      code,
      session,
    });

    lines.push({
      ledgerId: ledger._id,
      debitPaise: 0,
      creditPaise: amount,
    });
  }

  lines.push({
    ledgerId: invoice.customerLedgerId,

    debitPaise: invoice.totalAmountPaise,

    creditPaise: 0,
  });

  return lines;
};

const postInvoiceInTransaction = async (context) => {
  const { models, connection, tenant, tenantId, userId, invoice, session } =
    context;

  if (invoice.status !== "CREATED" || invoice.isDeleted) {
    throw createError("Only an active created invoice can be posted", 409);
  }

  if (invoice.totalAmountPaise <= 0) {
    throw createError("An invoice must have a positive total to be posted");
  }

  await validateLinkedSalesOrder(context);

  const oldData = invoice.toObject();

  const customer = await getCustomer({
    models,
    tenantId,
    customerId: invoice.customerId,
    session,
  });

  if (String(customer.ledgerId) !== String(invoice.customerLedgerId)) {
    throw createError(
      "Customer ledger changed. Review or recreate the invoice before posting.",
      409,
    );
  }

  const lines = await buildJournalLines({
    models,
    tenantId,
    invoice,
    session,
  });

  const journal = await postJournal({
    tenant,
    connection,
    userId,

    postingDate: invoice.invoiceDate,

    sourceType: "SALES_INVOICE",

    sourceId: invoice._id,

    sourceNumber: invoice.invoiceNumber,

    narration: `Sales invoice ${invoice.invoiceNumber} — ${invoice.customerName}`,

    lines,
    session,
  });

  if (invoice.updateStock) {
    const productIds = [
      ...new Set(invoice.items.map((item) => String(item.productId))),
    ];

    const products = await models.Product.find({
      _id: {
        $in: productIds,
      },
      tenantId,
      isDeleted: false,
      status: "ACTIVE",
    })
      .session(session)
      .lean();

    const productMap = new Map(
      products.map((product) => [String(product._id), product]),
    );

    for (const item of invoice.items) {
      const product = productMap.get(String(item.productId));

      if (
        !product ||
        product.type !== item.productType ||
        product.unit !== item.unit ||
        (product.type === "GOODS" && Boolean(product.trackInventory)) !==
          item.trackInventory
      ) {
        throw createError(
          `Product settings changed for ${item.productName}. Review the invoice before posting.`,
          409,
        );
      }

      if (!item.trackInventory) {
        continue;
      }

      await stockMovementService.createStockMovement({
        tenant,
        connection,
        userId,

        productId: item.productId,

        movementType: "SALE",

        quantity: item.quantity,

        unitRate: paiseToRupees(item.unitRatePaise),

        referenceType: "SALES_INVOICE",

        referenceId: invoice._id,

        referenceNumber: invoice.invoiceNumber,

        movementDate: invoice.invoiceDate,

        notes: `Sales invoice ${invoice.invoiceNumber}`,

        session,
      });
    }
  }

  const customerLedger = await models.Ledger.findOne({
    _id: invoice.customerLedgerId,

    tenantId,
  })
    .session(session)
    .lean();

  if (!customerLedger) {
    throw createError("Customer ledger was not found after posting", 409);
  }

  customer.receivableBalance =
    customerLedger.currentBalanceType === "DEBIT"
      ? customerLedger.currentBalance
      : 0;

  await customer.save({
    session,
  });

  invoice.status = "POSTED";
  invoice.journalId = journal._id;
  invoice.postedAt = new Date();
  invoice.postedBy = userId;
  invoice.updatedBy = userId;

  await invoice.save({
    session,
  });

  await createAudit({
    ...context,
    action: "POST",
    oldData,
  });

  return invoice;
};

const notifyInvoicePosted = async ({ tenantId, userId, invoice }) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,

      type: "SALES_INVOICE",

      title: "Sales invoice posted",

      message: `${invoice.invoiceNumber} for ${invoice.customerName} was posted successfully.`,

      icon: "file-text",
      priority: "NORMAL",
      route: "/sales/invoices",

      data: {
        salesInvoiceId: String(invoice._id),

        invoiceNumber: invoice.invoiceNumber,

        customerId: String(invoice.customerId),

        totalAmountPaise: invoice.totalAmountPaise,
      },
    });
  } catch (error) {
    console.error(
      "Sales invoice notification failed:",
      error?.message || error,
    );
  }
};

/* ==========================================
   SHARED CREATION
   ========================================== */

const persistCreatedInvoice = async (context, invoiceData) => {
  const { models, connection, tenantId, userId, session } = context;

  const invoiceNumber = await getNextSequence("SI", String(tenantId), 3, {
    connection,
    session,
  });

  const records = await models.SalesInvoice.create(
    [
      {
        ...invoiceData,
        tenantId,
        invoiceNumber,
        status: "CREATED",
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

  await createAudit({
    ...context,
    invoice,
    action: "CREATE",
  });

  return invoice;
};

/* ==========================================
   DIRECT INVOICE CREATION
   ========================================== */

const createSalesInvoice = async (args) => {
  const payload = args.payload || {};

  const action = payload.action || "SAVE_CREATED";

  if (!["SAVE_CREATED", "SAVE_AND_POST"].includes(action)) {
    throw createError("Invalid invoice action");
  }

  if (payload.sourceSalesOrderId || payload.sourceSalesOrderNumber) {
    throw createError(
      "Use the create-from-Sales-Order endpoint for linked invoices",
    );
  }

  const result = await runTransaction(args, async (context) => {
    const invoiceData = await calculateInvoice({
      ...context,
      payload,
    });

    const invoice = await persistCreatedInvoice(context, invoiceData);

    if (action === "SAVE_AND_POST") {
      await postInvoiceInTransaction({
        ...context,
        invoice,
      });
    }

    return invoice.toObject();
  });

  if (result.status === "POSTED") {
    await notifyInvoicePosted({
      tenantId: args.tenant._id ?? args.tenant.id,

      userId: args.userId,

      invoice: result,
    });
  }

  return result;
};

/* ==========================================
   CREATE FROM SALES ORDER
   ========================================== */

const createInvoiceFromSalesOrder = async (args) =>
  runTransaction(args, async (context) => {
    requireOrderModel(context);

    const { models, tenantId, session } = context;

    const payload = args.payload || {};

    const orderNumber = normalizeCode(args.orderNumber);

    if (!orderNumber) {
      throw createError("Sales Order number is required");
    }

    const order = await models.SalesOrder.findOne({
      tenantId,
      orderNumber,
      isDeleted: false,
    })
      .session(session)
      .lean();

    if (!order) {
      throw createError("Sales Order not found", 404);
    }

    await ensureNoOrderInvoice({
      models,
      tenantId,
      orderId: order._id,
      session,
    });

    if (!ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
      throw createError(
        "Confirm the Sales Order before creating an invoice",
        409,
      );
    }

    assertVersion(order, payload.version, "Sales Order");

    const invoiceDate = parseDate(payload.invoiceDate, "Invoice date");

    const orderDate = parseDate(order.orderDate, "Sales Order date");

    if (invoiceDate < orderDate) {
      throw createError("Invoice date cannot be before the Sales Order date");
    }

    if (!Array.isArray(order.items) || !order.items.length) {
      throw createError("The Sales Order has no items", 409);
    }

    const invoicePayload = {
      customerId: order.customerId,

      invoiceDate,

      dueDate: payload.dueDate,

      paymentTerms: order.paymentTerms,

      taxMode: order.taxMode,

      updateStock: false,

      items: order.items.map((item) => ({
        productId: item.productId,

        quantity: item.quantity,

        discountPercent: item.discountPercent,

        gstRate: item.gstRate,
      })),

      notes: order.notes,
    };

    const invoiceData = await calculateInvoice({
      ...context,
      payload: invoicePayload,
      sourceOrder: order,
    });

    const locked = await models.SalesOrder.updateOne(
      {
        _id: order._id,
        tenantId,
        isDeleted: false,
        status: order.status,
        __v: payload.version,
      },
      {
        $inc: { __v: 1 },
      },
      {
        session,
        timestamps: false,
      },
    );

    if (locked.modifiedCount !== 1) {
      throw createError("Sales Order changed. Refresh and try again.", 409);
    }

    const invoice = await persistCreatedInvoice(context, invoiceData);

    return invoice.toObject();
  });

/* ==========================================
   UPDATE / POST / DELETE
   ========================================== */

const updateSalesInvoice = async (args) =>
  runTransaction(args, async (context) => {
    const invoice = await getCreatedForUpdate({
      ...context,
      invoiceNumber: args.invoiceNumber,
    });

    if (invoice.sourceSalesOrderId) {
      throw createError(
        "Order-linked invoices cannot be edited through direct entry. Delete the created invoice and recreate it from the Sales Order.",
        409,
      );
    }

    const payload = args.payload || {};

    if (payload.sourceSalesOrderId || payload.sourceSalesOrderNumber) {
      throw createError(
        "Source Sales Order references cannot be assigned through direct editing",
      );
    }

    const oldData = invoice.toObject();

    const invoiceData = await calculateInvoice({
      ...context,
      payload,
    });

    invoice.set(invoiceData);

    invoice.updatedBy = context.userId;

    await invoice.save({
      session: context.session,
    });

    await createAudit({
      ...context,
      invoice,
      oldData,
      action: "UPDATE",
    });

    return invoice.toObject();
  });

const postSalesInvoice = async (args) => {
  const result = await runTransaction(args, async (context) => {
    const invoice = await getCreatedForUpdate({
      ...context,
      invoiceNumber: args.invoiceNumber,
    });

    await postInvoiceInTransaction({
      ...context,
      invoice,
    });

    return invoice.toObject();
  });

  await notifyInvoicePosted({
    tenantId: args.tenant._id ?? args.tenant.id,

    userId: args.userId,

    invoice: result,
  });

  return result;
};

const deleteSalesInvoice = async (args) =>
  runTransaction(args, async (context) => {
    const invoice = await getCreatedForUpdate({
      ...context,
      invoiceNumber: args.invoiceNumber,
    });

    const oldData = invoice.toObject();

    invoice.isDeleted = true;
    invoice.deletedAt = new Date();

    invoice.deletedBy = context.userId;

    invoice.updatedBy = context.userId;

    await invoice.save({
      session: context.session,
    });

    await createAudit({
      ...context,
      invoice,
      oldData,
      action: "DELETE",
    });

    return invoice.toObject();
  });

/* ==========================================
   LIST / DETAILS
   ========================================== */

const getSalesInvoices = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const currentPage = Math.max(Math.floor(Number(args.page) || 1), 1);

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(args.limit) || 20), 1),
    100,
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (args.customerId) {
    validateObjectId(args.customerId, "customerId");

    filter.customerId = args.customerId;
  }

  if (args.sourceSalesOrderId) {
    validateObjectId(args.sourceSalesOrderId, "sourceSalesOrderId");

    filter.sourceSalesOrderId = args.sourceSalesOrderId;
  }

  if (args.sourceSalesOrderNumber) {
    filter.sourceSalesOrderNumber = normalizeCode(args.sourceSalesOrderNumber);
  }

  if (args.status) {
    if (!INVOICE_STATUSES.includes(args.status)) {
      throw createError("Invalid invoice status");
    }

    filter.status = args.status;
  }

  if (args.paymentStatus) {
    if (!["UNPAID", "PARTIALLY_PAID", "PAID"].includes(args.paymentStatus)) {
      throw createError("Invalid payment status");
    }

    filter.paymentStatus = args.paymentStatus;
  }
  if (args.ewayBillStatus) {
    const now = new Date();

    const byStatus = {
      PENDING: {
        status: "POSTED",
        ewayBillRequired: true,
        "ewayBill.status": { $ne: "GENERATED" },
      },
      GENERATED: {
        "ewayBill.status": "GENERATED",
        "ewayBill.validUntil": { $gt: now },
      },
      EXPIRED: {
        "ewayBill.status": "GENERATED",
        "ewayBill.validUntil": { $lte: now },
      },
      CANCELLED: { "ewayBill.status": "CANCELLED" },
    };

    const extra = byStatus[args.ewayBillStatus];

    if (!extra) throw createError("Invalid e-way bill status");

    Object.assign(filter, extra);
  }
  const ewbLabel = (invoice) => {
    const ewb = invoice.ewayBill || {};
    if (ewb.status === "GENERATED")
      return new Date(ewb.validUntil) <= new Date()
        ? "EWB Expired"
        : `EWB ${ewb.ewbNumber}`;
    if (ewb.status === "CANCELLED") return "EWB Cancelled";
    return invoice.ewayBillRequired && invoice.status === "POSTED"
      ? "EWB Pending"
      : null;
  };
  if (args.fromDate || args.toDate) {
    filter.invoiceDate = {};

    const from = args.fromDate ? parseDate(args.fromDate, "From date") : null;

    const to = args.toDate ? parseDate(args.toDate, "To date") : null;

    if (from && to && to < from) {
      throw createError("To date cannot be before from date");
    }

    if (from) {
      filter.invoiceDate.$gte = from;
    }

    if (to) {
      /*
       * List filters represent calendar days.
       */
      const nextDay = new Date(to);

      nextDay.setUTCHours(0, 0, 0, 0);

      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      filter.invoiceDate.$lt = nextDay;
    }
  }

  const searchText = normalizeText(args.search);

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    filter.$or = [
      {
        invoiceNumber: regex,
      },
      {
        customerName: regex,
      },
      {
        customerCode: regex,
      },
      {
        sourceSalesOrderNumber: regex,
      },
    ];
  }

  const [data, total] = await Promise.all([
    models.SalesInvoice.find(filter)
      .select("-items")
      .sort({
        invoiceDate: -1,
        createdAt: -1,
        _id: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    models.SalesInvoice.countDocuments(filter),
  ]);

  return {
    data,

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,

      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getSalesInvoiceByNumber = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const invoice = await models.SalesInvoice.findOne({
    tenantId,

    invoiceNumber: normalizeCode(args.invoiceNumber),

    isDeleted: false,
  }).lean();

  if (!invoice) {
    throw createError("Sales invoice not found", 404);
  }

  return invoice;
};

module.exports = {
  createSalesInvoice,
  createInvoiceFromSalesOrder,
  updateSalesInvoice,
  postSalesInvoice,
  deleteSalesInvoice,
  getSalesInvoices,
  getSalesInvoiceByNumber,
};
