const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const {
  calculateQuotationData,
} = require("../supplier-quotations/supplierQuotation.service");

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

const EDITABLE_FIELDS = [
  "orderDate",
  "expectedDeliveryDate",
  "deliveryAddress",
  "notes",
  "paymentTerms",
  "deliveryTerms",
  "termsAndConditions",
  "taxMode",
  "items",
];

const SOURCE_LOCKED_FIELDS = [
  "paymentTerms",
  "deliveryTerms",
  "termsAndConditions",
  "taxMode",
  "items",
];

const hasOwn = (object, field) =>
  Object.prototype.hasOwnProperty.call(object, field);

const text = (value) => String(value ?? "").trim() || null;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const parseDate = (value, label) => {
  if (!value || !(typeof value === "string" || value instanceof Date)) {
    throw createError(`${label} is required`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError(`${label} is invalid`);
  }

  return date;
};

const assertVersion = (document, version) => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError("A valid document version is required");
  }

  if (document.__v !== version) {
    throw createError("Document changed. Reload before continuing.", 409);
  }
};

const expiredOn = (validUntil, orderDate) => {
  if (!validUntil) return false;

  const validity = parseDate(validUntil, "Quotation validity");

  return (
    orderDate.toISOString().slice(0, 10) > validity.toISOString().slice(0, 10)
  );
};

/* ==========================================
   CONTEXT / TRANSACTION
   ========================================== */

const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "PurchaseOrder",
    "SupplierQuotation",
    "PurchaseRfq",
    "Supplier",
    "Product",
    "AuditLog",
  ]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  return {
    ...args,
    connection,
    models,
    tenantId: objectId(args.tenant._id, "tenantId"),
  };
};

const transaction = async (args, operation) => {
  const context = resolveContext(args);
  context.userId = objectId(args.userId, "userId");

  const session = await context.connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({ ...context, session });
    });

    return result;
  } catch (error) {
    if (error.name === "VersionError") {
      throw createError("Document changed. Reload before continuing.", 409);
    }

    if (error.code === 11000) {
      throw createError(
        "An active Purchase Order already uses this quotation/RFQ, or the order number already exists",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const audit = async (context, document, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "PURCHASEORDER",
        documentId: document._id,
        oldData,
        newData: document.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session },
  );
};

const loadOrder = async (context) => {
  const orderNumber = text(context.orderNumber)?.toUpperCase();

  if (!orderNumber) {
    throw createError("Order number is required");
  }

  const document = await context.models.PurchaseOrder.findOne({
    tenantId: context.tenantId,
    orderNumber,
  }).session(context.session ?? null);

  if (!document) {
    throw createError("Purchase Order not found", 404);
  }

  return document;
};

const validateSupplier = async (context, supplierId) => {
  const id = objectId(supplierId, "supplierId");

  const exists = await context.models.Supplier.exists({
    _id: id,
    tenantId: context.tenantId,
    isDeleted: false,
  }).session(context.session);

  if (!exists) {
    throw createError("Supplier not found in this tenant", 404);
  }

  return id;
};

const buildHeader = (payload) => {
  const orderDate = parseDate(payload.orderDate, "Order date");

  const expectedDeliveryDate = payload.expectedDeliveryDate
    ? parseDate(payload.expectedDeliveryDate, "Expected delivery date")
    : null;

  if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
    throw createError("Expected delivery date cannot precede order date");
  }

  return {
    orderDate,
    expectedDeliveryDate,
    deliveryAddress: text(payload.deliveryAddress),
    notes: text(payload.notes),
  };
};

/* ==========================================
   SHARED CALCULATOR ADAPTER
   ========================================== */

const calculateDirectOrder = async (context, payload, existing = null) => {
  const calculated = await calculateQuotationData(
    context,
    {
      quotationDate: payload.orderDate,
      validUntil: null,
      taxMode: payload.taxMode,
      items: payload.items,
      paymentTerms: payload.paymentTerms,
      deliveryTerms: payload.deliveryTerms,
      termsAndConditions: payload.termsAndConditions,
      notes: payload.notes,
    },
    null,
    existing,
  );

  return {
    currency: calculated.currency,
    taxMode: calculated.taxMode,

    items: calculated.items.map((item) => {
      const { rfqLineId, ...rest } = item;

      return {
        ...rest,
        quotationLineId: null,
      };
    }),

    ...Object.fromEntries(
      AMOUNT_FIELDS.map((field) => [field, calculated[field]]),
    ),

    paymentTerms: calculated.paymentTerms,
    deliveryTerms: calculated.deliveryTerms,
    termsAndConditions: calculated.termsAndConditions,
  };
};

/* ==========================================
   SOURCE QUOTATION CONVERSION
   ========================================== */

const loadAndLockQuotation = async (context, payload) => {
  const quotation = await context.models.SupplierQuotation.findOne({
    _id: objectId(payload.sourceQuotationId, "sourceQuotationId"),
    tenantId: context.tenantId,
    isDeleted: false,
    status: "CREATED",
  }).session(context.session);

  if (!quotation) {
    throw createError("Active supplier quotation not found", 404);
  }

  assertVersion(quotation, payload.sourceQuotationVersion);

  const locked = await context.models.SupplierQuotation.updateOne(
    {
      _id: quotation._id,
      tenantId: context.tenantId,
      status: "CREATED",
      isDeleted: false,
      __v: payload.sourceQuotationVersion,
    },
    {
      $inc: { __v: 1 },
    },
    {
      session: context.session,
      timestamps: false,
    },
  );

  if (locked.modifiedCount !== 1) {
    throw createError(
      "Selected quotation changed. Refresh the comparison.",
      409,
    );
  }

  return quotation;
};

const validateAndLockSourceRfq = async (context, quotation) => {
  if (quotation.creationMode !== "RFQ") {
    return null;
  }

  const rfq = await context.models.PurchaseRfq.findOne({
    _id: quotation.sourceRfqId,
    tenantId: context.tenantId,
    isDeleted: false,
    status: { $in: ["ISSUED", "CLOSED"] },
  })
    .session(context.session)
    .lean();

  if (!rfq) {
    throw createError("Source RFQ is unavailable", 409);
  }

  if (
    !rfq.supplierIds.some((id) => String(id) === String(quotation.supplierId))
  ) {
    throw createError(
      "Quotation supplier does not belong to the source RFQ",
      409,
    );
  }

  const sourceLines = new Map(
    rfq.items.map((item) => [String(item.lineId), item]),
  );

  const seen = new Set();

  for (const item of quotation.items) {
    const key = String(item.rfqLineId);
    const source = sourceLines.get(key);

    if (
      !source ||
      seen.has(key) ||
      String(source.productId) !== String(item.productId) ||
      source.unit !== item.unit ||
      source.productType !== item.productType ||
      item.quantity > source.quantity
    ) {
      throw createError("Quotation items do not match the source RFQ", 409);
    }

    seen.add(key);
  }

  const result = await context.models.PurchaseRfq.updateOne(
    {
      _id: rfq._id,
      tenantId: context.tenantId,
      isDeleted: false,
      status: rfq.status,
      __v: rfq.__v,
    },
    {
      $inc: { __v: 1 },
    },
    {
      session: context.session,
      timestamps: false,
    },
  );

  if (result.modifiedCount !== 1) {
    throw createError("Source RFQ changed. Reload and retry.", 409);
  }

  return rfq;
};

const buildFromQuotation = async (context, quotation, header) => {
  if (header.orderDate < quotation.quotationDate) {
    throw createError("Order date cannot precede quotation date");
  }

  if (expiredOn(quotation.validUntil, header.orderDate)) {
    throw createError(
      "The quotation is not valid on the selected order date",
      409,
    );
  }

  const calculated = await calculateDirectOrder(context, {
    orderDate: header.orderDate,
    taxMode: quotation.taxMode,

    items: quotation.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitRatePaise: item.unitRatePaise,
      discountPercent: item.discountPercent,
      gstRate: item.gstRate,
      specification: item.specification,
    })),

    paymentTerms: quotation.paymentTerms,
    deliveryTerms: quotation.deliveryTerms,
    termsAndConditions: quotation.termsAndConditions,
  });

  for (const field of AMOUNT_FIELDS) {
    if (calculated[field] !== quotation[field]) {
      throw createError(
        "Quotation totals do not match current calculations. Review the source quotation.",
        409,
      );
    }
  }

  calculated.items = calculated.items.map((item, index) => {
    const source = quotation.items[index];

    if (
      item.productType !== source.productType ||
      item.unit !== source.unit ||
      AMOUNT_FIELDS.some((field) => item[field] !== source[field])
    ) {
      throw createError(
        "Quotation product details or amounts are inconsistent",
        409,
      );
    }

    return {
      ...item,
      quotationLineId: source.lineId,
      productCode: source.productCode,
      productName: source.productName,
      productType: source.productType,
      unit: source.unit,
      hsnSacCode: source.hsnSacCode,
    };
  });

  return calculated;
};

/* ==========================================
   CREATE
   ========================================== */

const createOrder = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};
    const header = buildHeader(payload);

    let supplierId;
    let financialData;
    let sourceData;

    if (payload.creationMode === "DIRECT") {
      supplierId = await validateSupplier(context, payload.supplierId);

      financialData = await calculateDirectOrder(context, payload);

      sourceData = {
        sourceQuotationId: null,
        sourceQuotationNumber: null,
        sourceQuotationVersion: null,
        sourceRfqId: null,
        reservesSource: false,
      };
    } else if (payload.creationMode === "QUOTATION") {
      const quotation = await loadAndLockQuotation(context, payload);

      supplierId = await validateSupplier(context, quotation.supplierId);

      const rfq = await validateAndLockSourceRfq(context, quotation);

      financialData = await buildFromQuotation(context, quotation, header);

      sourceData = {
        sourceQuotationId: quotation._id,
        sourceQuotationNumber: quotation.quotationNumber,
        sourceQuotationVersion: payload.sourceQuotationVersion,
        sourceRfqId: rfq?._id || null,
        reservesSource: true,
      };
    } else {
      throw createError("Invalid creation mode");
    }

    if (financialData.totalAmountPaise <= 0) {
      throw createError("A Purchase Order requires a positive total");
    }

    const orderNumber = await getNextSequence(
      "PO",
      String(context.tenantId),
      3,
      {
        connection: context.connection,
        session: context.session,
      },
    );

    const [document] = await context.models.PurchaseOrder.create(
      [
        {
          ...header,
          ...financialData,
          ...sourceData,
          tenantId: context.tenantId,
          orderNumber,
          creationMode: payload.creationMode,
          supplierId,
          status: "CREATED",
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      { session: context.session },
    );

    await audit(context, document, "CREATE");

    return document.toObject();
  });

/* ==========================================
   READ
   ========================================== */

const getOrder = async (args) => {
  const context = resolveContext(args);
  return (await loadOrder(context)).toObject();
};

const listOrders = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const { page = 1, limit = 20, search, status, creationMode } = args;

  const filter = { tenantId };

  if (status) filter.status = status;
  if (creationMode) filter.creationMode = creationMode;

  for (const field of ["supplierId", "sourceQuotationId", "sourceRfqId"]) {
    if (args[field]) {
      filter[field] = objectId(args[field], field);
    }
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");

    filter.$or = [{ orderNumber: regex }, { sourceQuotationNumber: regex }];
  }

  const [data, total] = await Promise.all([
    models.PurchaseOrder.find(filter)
      .sort({ orderDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    models.PurchaseOrder.countDocuments(filter),
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
   UPDATE
   ========================================== */

const updateOrder = (args) =>
  transaction(args, async (context) => {
    const document = await loadOrder(context);
    const payload = args.payload || {};

    assertVersion(document, payload.version);

    if (document.status !== "CREATED") {
      throw createError("Only CREATED Purchase Orders can be edited", 409);
    }

    if (
      document.creationMode === "QUOTATION" &&
      SOURCE_LOCKED_FIELDS.some((field) => hasOwn(payload, field))
    ) {
      throw createError(
        "Quotation-based order items, prices, taxes, and commercial terms are locked",
        409,
      );
    }

    await validateSupplier(context, document.supplierId);

    const oldData = document.toObject();
    const merged = {};

    for (const field of EDITABLE_FIELDS) {
      merged[field] = hasOwn(payload, field) ? payload[field] : oldData[field];
    }

    const header = buildHeader(merged);

    let financialData = {};

    if (document.creationMode === "DIRECT") {
      financialData = await calculateDirectOrder(context, merged, document);

      if (financialData.totalAmountPaise <= 0) {
        throw createError("A Purchase Order requires a positive total");
      }
    } else {
      const quotation = await context.models.SupplierQuotation.findOne({
        _id: document.sourceQuotationId,
        tenantId: context.tenantId,
        isDeleted: false,
        status: "CREATED",
      })
        .session(context.session)
        .lean();

      if (!quotation) {
        throw createError("Source quotation is unavailable", 409);
      }

      if (
        header.orderDate < quotation.quotationDate ||
        expiredOn(quotation.validUntil, header.orderDate)
      ) {
        throw createError(
          "Order date is outside the source quotation's validity",
          409,
        );
      }
    }

    document.set({
      ...header,
      ...financialData,
      updatedBy: context.userId,
    });

    await document.save({ session: context.session });
    await audit(context, document, "UPDATE", oldData);

    return document.toObject();
  });

/* ==========================================
   CANCEL
   ========================================== */

const cancelOrder = (args) =>
  transaction(args, async (context) => {
    const document = await loadOrder(context);

    assertVersion(document, args.payload?.version);

    if (document.status !== "CREATED") {
      throw createError(
        "Only unreceived CREATED Purchase Orders can be cancelled",
        409,
      );
    }

    const reason = text(args.payload?.cancellationReason);

    if (!reason) {
      throw createError("Cancellation reason is required");
    }

    const oldData = document.toObject();

    document.status = "CANCELLED";
    document.cancelledAt = new Date();
    document.cancelledBy = context.userId;
    document.cancellationReason = reason;
    document.reservesSource = false;
    document.updatedBy = context.userId;

    await document.save({ session: context.session });
    await audit(context, document, "CANCEL", oldData);

    return document.toObject();
  });

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
  cancelOrder,
};
