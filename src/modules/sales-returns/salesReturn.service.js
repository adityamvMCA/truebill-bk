const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");
const {
  postJournal,
} = require("../../modules/accounting/journals/journal.service");
const {
  createStockMovement,
} = require("../stock-movements/stockMovement.service");

const OUTPUT_TAX_LEDGER_FIELDS = {
  cgstAmountPaise: "OUTPUT_CGST",
  sgstAmountPaise: "OUTPUT_SGST",
  igstAmountPaise: "OUTPUT_IGST",
};

const postSalesReturn = async ({ tenant, userId, ipAddress, returnNumber }) => {
  return runTransaction(
    { tenant, userId },
    async ({ models, tenantId, connection, session }) => {
      const salesReturn = await models.SalesReturn.findOne({
        tenantId,
        returnNumber: normalizeCode(returnNumber),
        isDeleted: false,
      }).session(session);

      if (!salesReturn) {
        throw createError("Sales return not found", 404);
      }

      if (salesReturn.status === "POSTED" || salesReturn.journalId) {
        throw createError("This sales return is already posted", 409);
      }

      if (salesReturn.status !== "CREATED") {
        throw createError(
          "Only sales returns in CREATED status can be posted",
          409,
        );
      }

      const oldData = salesReturn.toObject();

      const invoice = await models.SalesInvoice.findOne({
        _id: salesReturn.sourceSalesInvoiceId,
        tenantId,
        isDeleted: false,
        status: "POSTED",
      })
        .session(session)
        .lean();

      if (!invoice) {
        throw createError("Source sales invoice is unavailable", 409);
      }

      await buildReturnItems({
        invoice,
        requestedItems: salesReturn.items.map((item) => ({
          invoiceItemIndex: item.invoiceItemIndex,
          quantity: item.quantity,
        })),
        models,
        tenantId,
        session,
        returnNumberToExclude: salesReturn.returnNumber,
      });

      if (!salesReturn.customerLedgerId) {
        throw createError("Customer ledger is missing on this return", 409);
      }

      const debitByLedger = new Map();

      const addDebit = (ledgerId, amount) => {
        if (!amount) return;

        const key = String(ledgerId);

        debitByLedger.set(
          key,
          safeAmount((debitByLedger.get(key) || 0) + amount),
        );
      };

      for (const item of salesReturn.items) {
        if (!item.salesLedgerId) {
          throw createError(
            `Sales ledger missing for ${item.productName}`,
            409,
          );
        }

        addDebit(item.salesLedgerId, item.taxableAmountPaise);
      }

      const taxFields = Object.keys(OUTPUT_TAX_LEDGER_FIELDS).filter(
        (field) => Number(salesReturn[field]) > 0,
      );

      if (taxFields.length) {
        const taxConfiguration = await models.TaxConfiguration.findOne({
          tenantId,
        })
          .session(session)
          .lean();

        for (const field of taxFields) {
          const ledgerId = taxConfiguration?.[OUTPUT_TAX_LEDGER_FIELDS[field]];

          if (!ledgerId) {
            throw createError(
              "Output tax ledgers are not configured. Set them in GST & Tax > Tax Configuration",
              409,
            );
          }

          addDebit(ledgerId, salesReturn[field]);
        }
      }

      const totalDebit = [...debitByLedger.values()].reduce(
        (sum, value) => safeAmount(sum + value),
        0,
      );

      if (totalDebit !== salesReturn.totalAmountPaise) {
        throw createError(
          "Return component amounts do not add up to the return total",
          409,
        );
      }

      const lines = [
        ...[...debitByLedger].map(([ledgerId, debitPaise]) => ({
          ledgerId,
          debitPaise,
          creditPaise: 0,
          narration: `Sales return ${salesReturn.returnNumber}`,
        })),
        {
          ledgerId: salesReturn.customerLedgerId,
          debitPaise: 0,
          creditPaise: totalDebit,
          narration: `Credit for ${salesReturn.sourceInvoiceNumber}`,
        },
      ];

      const journal = await postJournal({
        tenant,
        connection,
        userId,
        postingDate: salesReturn.returnDate,
        sourceType: "SALES_RETURN",
        sourceId: salesReturn._id,
        sourceNumber: salesReturn.returnNumber,
        narration: `Sales return ${salesReturn.returnNumber} against ${salesReturn.sourceInvoiceNumber}`,
        lines,
        session,
      });

      if (salesReturn.updateStock) {
        for (const item of salesReturn.items) {
          if (item.productType !== "GOODS" || !item.trackInventory) continue;

          await createStockMovement({
            tenant,
            connection,
            userId,
            productId: item.productId,
            movementType: "SALES_RETURN",
            quantity: item.quantity,
            unitRate: item.unitRatePaise / 100,
            referenceType: "SALES_RETURN",
            referenceId: salesReturn._id,
            referenceNumber: salesReturn.returnNumber,
            movementDate: salesReturn.returnDate,
            notes: `Sales return ${salesReturn.returnNumber}`,
            session,
          });
        }
      }

      salesReturn.status = "POSTED";
      salesReturn.journalId = journal._id;
      salesReturn.postedAt = new Date();
      salesReturn.postedBy = userId;
      salesReturn.updatedBy = userId;

      await salesReturn.save({ session });

      await createAudit({
        models,
        tenantId,
        userId,
        action: "POST",
        salesReturn,
        oldData,
        ipAddress,
        session,
      });

      return salesReturn;
    },
  );
};
const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return value;
};

const parseReturnDate = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError("A valid return date is required");
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError("Return date is invalid");
  }

  return date;
};

const assertQuantity = (quantity) => {
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    throw createError("Return quantity must be greater than zero");
  }

  const scaled = quantity * 10000;

  if (
    !Number.isSafeInteger(Math.round(scaled)) ||
    Math.abs(scaled - Math.round(scaled)) > 0.000001
  ) {
    throw createError("Return quantity supports up to 4 decimal places");
  }
};

const safeAmount = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError("Calculated amount is outside the supported range");
  }

  return value;
};

const multiplyDivide = (amount, quantity, divisor) => {
  safeAmount(amount);

  if (
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    !Number.isFinite(divisor) ||
    divisor <= 0
  ) {
    throw createError("Invalid amount calculation");
  }

  const numerator = BigInt(amount) * BigInt(Math.round(quantity * 10000));

  const denominator = BigInt(Math.round(divisor * 10000));

  const result = (numerator + denominator / 2n) / denominator;

  return safeAmount(Number(result));
};

const resolveContext = ({ tenant, ...args }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  validateObjectId(tenantId, "tenantId");

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["SalesReturn", "SalesInvoice", "AuditLog"]) {
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
  } finally {
    await session.endSession();
  }
};

const createAudit = async ({
  models,
  tenantId,
  userId,
  action,
  salesReturn,
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
        module: "SALES_RETURN",
        documentId: salesReturn._id,
        oldData,
        newData: salesReturn.toObject(),
        ipAddress,
      },
    ],
    {
      session,
      ordered: true,
    },
  );
};

const getCreatedForUpdate = async ({
  models,
  tenantId,
  returnNumber,
  session,
}) => {
  const salesReturn = await models.SalesReturn.findOne({
    tenantId,
    returnNumber: normalizeCode(returnNumber),
    isDeleted: false,
  }).session(session);

  if (!salesReturn) {
    throw createError("Sales return not found", 404);
  }

  if (salesReturn.status !== "CREATED") {
    throw createError(
      "Only sales returns in CREATED status can be updated or deleted",
      409,
    );
  }

  return salesReturn;
};

/*
 * Rebuild return lines from the posted source invoice.
 * Amounts are calculated from the invoice, not accepted from the client.
 */
const buildReturnItems = async ({
  invoice,
  requestedItems,
  models,
  tenantId,
  session,
  returnNumberToExclude,
}) => {
  if (!Array.isArray(requestedItems) || requestedItems.length < 1) {
    throw createError("At least one return item is required");
  }

  const seen = new Set();

  const existingFilter = {
    tenantId,
    sourceSalesInvoiceId: invoice._id,
    isDeleted: false,
    status: { $ne: "CANCELLED" },
  };

  if (returnNumberToExclude) {
    existingFilter.returnNumber = { $ne: returnNumberToExclude };
  }

  const existingReturns = await models.SalesReturn.find(existingFilter)
    .session(session)
    .lean();

  const alreadyReturned = new Map();

  for (const existingReturn of existingReturns) {
    for (const item of existingReturn.items || []) {
      const key = String(item.invoiceItemIndex);

      alreadyReturned.set(
        key,
        (alreadyReturned.get(key) || 0) + Number(item.quantity || 0),
      );
    }
  }

  const items = [];

  for (const requested of requestedItems) {
    const index = requested.invoiceItemIndex;
    const quantity = requested.quantity;

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= invoice.items.length
    ) {
      throw createError("A return item references an invalid invoice line");
    }

    if (seen.has(index)) {
      throw createError(
        "Duplicate invoice lines are not allowed in one return",
      );
    }

    seen.add(index);
    assertQuantity(quantity);

    const source = invoice.items[index];

    const previouslyReturned = alreadyReturned.get(String(index)) || 0;
    const availableQuantity = Number(source.quantity) - previouslyReturned;

    if (quantity > availableQuantity + 0.000001) {
      throw createError(
        `Return quantity exceeds the available quantity for ${source.productName}`,
        409,
      );
    }

    const sourceQuantity = Number(source.quantity);

    if (!sourceQuantity || sourceQuantity <= 0) {
      throw createError(
        "The source invoice contains an invalid item quantity",
        409,
      );
    }

    const returned = {
      invoiceItemIndex: index,
      productId: source.productId,
      productCode: source.productCode,
      productName: source.productName,
      productType: source.productType,
      trackInventory: source.trackInventory,
      unit: source.unit,
      hsnSacCode: source.hsnSacCode || null,
      quantity,
      unitRatePaise: source.unitRatePaise,
      discountPercent: source.discountPercent,
      gstRate: source.gstRate,
      salesLedgerId: source.salesLedgerId,
    };

    for (const field of [
      "grossAmountPaise",
      "discountAmountPaise",
      "taxableAmountPaise",
      "cgstAmountPaise",
      "sgstAmountPaise",
      "igstAmountPaise",
      "totalAmountPaise",
    ]) {
      returned[field] = multiplyDivide(
        Number(source[field] || 0),
        quantity,
        sourceQuantity,
      );
    }

    items.push(returned);
  }

  return items;
};

const calculateTotals = (items) => {
  const fields = [
    "grossAmountPaise",
    "discountAmountPaise",
    "taxableAmountPaise",
    "cgstAmountPaise",
    "sgstAmountPaise",
    "igstAmountPaise",
    "totalAmountPaise",
  ];

  const totals = {};

  for (const field of fields) {
    totals[field] = items.reduce(
      (sum, item) => safeAmount(sum + Number(item[field] || 0)),
      0,
    );
  }

  return totals;
};

/* ==========================================
   CREATE
   ========================================== */

const createSalesReturn = async ({
  tenant,
  userId,
  ipAddress,
  payload = {},
}) => {
  const invoiceNumber = normalizeCode(payload.invoiceNumber);

  if (!invoiceNumber) {
    throw createError("Invoice number is required");
  }

  const returnDate = parseReturnDate(payload.returnDate);

  if (
    typeof payload.updateStock !== "boolean" &&
    payload.updateStock !== undefined
  ) {
    throw createError("updateStock must be true or false");
  }

  return runTransaction(
    { tenant, userId },
    async ({ models, tenantId, connection, session }) => {
      const invoice = await models.SalesInvoice.findOne({
        tenantId,
        invoiceNumber,
        isDeleted: false,
      })
        .session(session)
        .lean();

      if (!invoice) {
        throw createError("Sales invoice not found", 404);
      }

      if (invoice.status !== "POSTED") {
        throw createError("Only posted sales invoices can be returned", 409);
      }

      if (returnDate < new Date(invoice.invoiceDate)) {
        throw createError("Return date cannot be before invoice date");
      }

      const items = await buildReturnItems({
        invoice,
        requestedItems: payload.items,
        models,
        tenantId,
        session,
      });

      const totals = calculateTotals(items);

      const returnNumber = await getNextSequence("SR", String(tenantId), 3, {
        connection,
        session,
      });

      const [salesReturn] = await models.SalesReturn.create(
        [
          {
            tenantId,
            returnNumber,
            sourceSalesInvoiceId: invoice._id,
            sourceInvoiceNumber: invoice.invoiceNumber,
            customerId: invoice.customerId,
            customerCode: invoice.customerCode,
            customerName: invoice.customerName,
            customerLedgerId: invoice.customerLedgerId,
            returnDate,
            currency: "INR",
            taxMode: invoice.taxMode,
            updateStock: payload.updateStock ?? false,
            items,
            ...totals,
            status: "CREATED",
            notes: normalizeText(payload.notes) || null,
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session },
      );

      await createAudit({
        models,
        tenantId,
        userId,
        action: "CREATE",
        salesReturn,
        ipAddress,
        session,
      });

      return salesReturn;
    },
  );
};

/* ==========================================
   GET ALL
   ========================================== */

const getSalesReturns = async ({
  tenant,
  page = 1,
  limit = 10,
  search = "",
  status,
  invoiceNumber,
  customerId,
  fromDate,
  toDate,
}) => {
  const { models, tenantId } = resolveContext({ tenant });

  page = Number(page);
  limit = Number(limit);

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) filter.status = status;

  if (invoiceNumber) {
    // filter.sourceSalesInvoiceNumber = normalizeCode(invoiceNumber);
    filter.sourceInvoiceNumber = normalizeCode(invoiceNumber);
  }

  if (customerId) {
    validateObjectId(customerId, "customerId");
    filter.customerId = customerId;
  }

  if (fromDate || toDate) {
    filter.returnDate = {};

    if (fromDate) filter.returnDate.$gte = parseReturnDate(fromDate);
    if (toDate) filter.returnDate.$lte = parseReturnDate(toDate);
  }

  if (search) {
    const escaped = normalizeText(search).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    filter.$or = [
      { returnNumber: { $regex: escaped, $options: "i" } },
      { sourceInvoiceNumber: { $regex: escaped, $options: "i" } },
      { customerName: { $regex: escaped, $options: "i" } },
      { customerCode: { $regex: escaped, $options: "i" } },
    ];
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    models.SalesReturn.find(filter)
      .sort({ returnDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    models.SalesReturn.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/* ==========================================
   GET BY NUMBER
   ========================================== */

const getSalesReturnByNumber = async ({ tenant, returnNumber }) => {
  const { models, tenantId } = resolveContext({ tenant });

  const salesReturn = await models.SalesReturn.findOne({
    tenantId,
    returnNumber: normalizeCode(returnNumber),
    isDeleted: false,
  }).lean();

  if (!salesReturn) {
    throw createError("Sales return not found", 404);
  }

  return salesReturn;
};

/* ==========================================
   UPDATE
   ========================================== */

const updateSalesReturn = async ({
  tenant,
  userId,
  ipAddress,
  returnNumber,
  payload = {},
}) => {
  return runTransaction(
    { tenant, userId },
    async ({ models, tenantId, session }) => {
      const salesReturn = await getCreatedForUpdate({
        models,
        tenantId,
        returnNumber,
        session,
      });

      const oldData = salesReturn.toObject();

      const invoice = await models.SalesInvoice.findOne({
        _id: salesReturn.sourceSalesInvoiceId,
        tenantId,
        isDeleted: false,
        status: "POSTED",
      })
        .session(session)
        .lean();

      if (!invoice) {
        throw createError("Source sales invoice is unavailable", 409);
      }

      const nextDate = payload.returnDate
        ? parseReturnDate(payload.returnDate)
        : new Date(salesReturn.returnDate);

      if (nextDate < new Date(invoice.invoiceDate)) {
        throw createError("Return date cannot be before invoice date");
      }

      if (payload.items) {
        const items = await buildReturnItems({
          invoice,
          requestedItems: payload.items,
          models,
          tenantId,
          session,
          returnNumberToExclude: salesReturn.returnNumber,
        });

        salesReturn.items = items;
        Object.assign(salesReturn, calculateTotals(items));
      }

      if (payload.returnDate !== undefined) {
        salesReturn.returnDate = nextDate;
      }

      if (payload.updateStock !== undefined) {
        if (typeof payload.updateStock !== "boolean") {
          throw createError("updateStock must be true or false");
        }

        salesReturn.updateStock = payload.updateStock;
      }

      if (payload.notes !== undefined) {
        salesReturn.notes = normalizeText(payload.notes) || null;
      }

      salesReturn.updatedBy = userId;

      await salesReturn.save({ session });

      await createAudit({
        models,
        tenantId,
        userId,
        action: "UPDATE",
        salesReturn,
        oldData,
        ipAddress,
        session,
      });

      return salesReturn;
    },
  );
};

/* ==========================================
   DELETE (SOFT DELETE)
   ========================================== */

const deleteSalesReturn = async ({
  tenant,
  userId,
  ipAddress,
  returnNumber,
}) => {
  return runTransaction(
    { tenant, userId },
    async ({ models, tenantId, session }) => {
      const salesReturn = await getCreatedForUpdate({
        models,
        tenantId,
        returnNumber,
        session,
      });

      const oldData = salesReturn.toObject();

      salesReturn.isDeleted = true;
      salesReturn.deletedAt = new Date();
      salesReturn.deletedBy = userId;
      salesReturn.updatedBy = userId;

      await salesReturn.save({ session });

      await createAudit({
        models,
        tenantId,
        userId,
        action: "DELETE",
        salesReturn,
        oldData,
        ipAddress,
        session,
      });
    },
  );
};

module.exports = {
  createSalesReturn,
  getSalesReturns,
  getSalesReturnByNumber,
  updateSalesReturn,
  deleteSalesReturn,
  postSalesReturn,
};
