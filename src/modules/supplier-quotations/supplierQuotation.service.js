const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../utils/sequenceGenerator");

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
  "supplierReferenceNumber",
  "quotationDate",
  "validUntil",
  "taxMode",
  "items",
  "paymentTerms",
  "deliveryTerms",
  "termsAndConditions",
  "notes",
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

const safeAmount = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError("Amount exceeds the supported range");
  }

  return value;
};

const multiplyDivide = (first, second, divisor) => {
  safeAmount(first);
  safeAmount(second);

  const numerator = BigInt(first) * BigInt(second);
  const denominator = BigInt(divisor);

  return safeAmount(Number((numerator + denominator / 2n) / denominator));
};

const scaledNumber = (value, scale, min, max, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw createError(`${label} is invalid`);
  }

  const scaled = value * scale;
  const rounded = Math.round(scaled);

  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw createError(`${label} has too many decimal places`);
  }

  return rounded;
};

const assertVersion = (document, version) => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError("A valid document version is required");
  }

  if (document.__v !== version) {
    throw createError("Document changed. Reload before continuing.", 409);
  }
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
        "This supplier already has a quotation for the RFQ, or the quotation number already exists",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/* ==========================================
   LOAD / AUDIT / SUPPLIER
   ========================================== */

const loadQuotation = async (context) => {
  const quotationNumber = text(context.quotationNumber)?.toUpperCase();

  if (!quotationNumber) {
    throw createError("Quotation number is required");
  }

  const document = await context.models.SupplierQuotation.findOne({
    tenantId: context.tenantId,
    quotationNumber,
    isDeleted: false,
  }).session(context.session ?? null);

  if (!document) {
    throw createError("Supplier quotation not found", 404);
  }

  return document;
};

const audit = async (context, document, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "SUPPLIERQUOTATION",
        documentId: document._id,
        oldData,
        newData: document.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session },
  );
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

/* ==========================================
   RFQ VALIDATION / CONCURRENCY
   ========================================== */

const lockRfq = async (context, sourceRfqId, supplierId, expectedVersion) => {
  const rfq = await context.models.PurchaseRfq.findOne({
    _id: objectId(sourceRfqId, "sourceRfqId"),
    tenantId: context.tenantId,
    isDeleted: false,
    status: "ISSUED",
  })
    .session(context.session)
    .lean();

  if (!rfq) {
    throw createError("An ISSUED source RFQ is required", 409);
  }

  if (expectedVersion !== undefined) {
    assertVersion(rfq, expectedVersion);
  }

  if (!rfq.supplierIds.some((id) => String(id) === String(supplierId))) {
    throw createError("The selected supplier was not invited to this RFQ", 409);
  }

  const result = await context.models.PurchaseRfq.updateOne(
    {
      _id: rfq._id,
      tenantId: context.tenantId,
      status: "ISSUED",
      isDeleted: false,
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
    throw createError("Source RFQ changed. Reload before continuing.", 409);
  }

  return rfq;
};

/* ==========================================
   CALCULATION
   ========================================== */

const calculate = async (context, payload, rfq = null, existing = null) => {
  const quotationDate = parseDate(payload.quotationDate, "Quotation date");

  const validUntil = payload.validUntil
    ? parseDate(payload.validUntil, "Validity date")
    : null;

  if (validUntil && validUntil < quotationDate) {
    throw createError("Validity date cannot precede quotation date");
  }

  if (rfq && quotationDate < rfq.rfqDate) {
    throw createError("Quotation date cannot precede RFQ date");
  }

  if (!["NONE", "INTRA_STATE", "INTER_STATE"].includes(payload.taxMode)) {
    throw createError("Invalid tax mode");
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("Provide between 1 and 200 items");
  }

  const ids = [
    ...new Set(
      payload.items.map((item) =>
        String(objectId(item.productId, "productId")),
      ),
    ),
  ];

  const products = await context.models.Product.find({
    tenantId: context.tenantId,
    _id: { $in: ids },
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(context.session)
    .lean();

  if (products.length !== ids.length) {
    throw createError(
      "One or more products are missing, inactive, or outside this tenant",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const sourceLines = new Map(
    (rfq?.items || []).map((item) => [String(item.lineId), item]),
  );

  const previousLines = new Map(
    (existing?.items || []).map((item) => [String(item.lineId), item]),
  );

  const seenLines = new Set();
  const seenSourceLines = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const items = payload.items.map((input) => {
    const product = productMap.get(
      String(objectId(input.productId, "productId")),
    );

    const lineId = input.lineId
      ? objectId(input.lineId, "lineId")
      : new mongoose.Types.ObjectId();

    const key = String(lineId);

    if (seenLines.has(key)) {
      throw createError("Each lineId must be unique");
    }

    seenLines.add(key);

    const previous = previousLines.get(key);

    if (previous && String(previous.productId) !== String(product._id)) {
      throw createError(
        "An existing lineId cannot be reused for another product",
        409,
      );
    }

    const quantityMilli = scaledNumber(
      input.quantity,
      1000,
      0.001,
      1000000,
      "Quantity",
    );

    let rfqLineId = null;
    let sourceLine = null;

    if (rfq) {
      rfqLineId = objectId(input.rfqLineId, "rfqLineId");
      const sourceKey = String(rfqLineId);

      sourceLine = sourceLines.get(sourceKey);

      if (!sourceLine || String(sourceLine.productId) !== String(product._id)) {
        throw createError(
          "Quotation item does not match the source RFQ line",
          409,
        );
      }

      if (seenSourceLines.has(sourceKey)) {
        throw createError("An RFQ line cannot appear twice");
      }

      seenSourceLines.add(sourceKey);

      if (quantityMilli > Math.round(sourceLine.quantity * 1000)) {
        throw createError(
          "Quoted quantity cannot exceed the RFQ line quantity",
        );
      }

      if (
        product.type !== sourceLine.productType ||
        product.unit !== sourceLine.unit
      ) {
        throw createError(
          "Product type or unit changed since RFQ creation",
          409,
        );
      }

      if (previous && String(previous.rfqLineId) !== sourceKey) {
        throw createError(
          "An existing lineId cannot be reassigned to another RFQ line",
          409,
        );
      }
    } else if (input.rfqLineId != null) {
      throw createError("DIRECT quotation items cannot reference RFQ lines");
    }

    const unitRatePaise = safeAmount(input.unitRatePaise);

    if (unitRatePaise > 100000000000) {
      throw createError("Unit rate exceeds the supported range");
    }

    const discountBasisPoints = scaledNumber(
      input.discountPercent ?? 0,
      100,
      0,
      100,
      "Discount",
    );

    const gstRate = input.gstRate;

    if (![0, 3, 5, 12, 18, 28].includes(gstRate)) {
      throw createError("Invalid GST rate");
    }

    if (payload.taxMode === "NONE" && gstRate !== 0) {
      throw createError("NONE tax mode requires zero GST rate");
    }

    const grossAmountPaise = multiplyDivide(unitRatePaise, quantityMilli, 1000);

    const discountAmountPaise = multiplyDivide(
      grossAmountPaise,
      discountBasisPoints,
      10000,
    );

    const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

    const taxPaise = multiplyDivide(taxableAmountPaise, gstRate, 100);

    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    if (payload.taxMode === "INTRA_STATE") {
      cgstAmountPaise = Math.floor(taxPaise / 2);
      sgstAmountPaise = taxPaise - cgstAmountPaise;
    }

    if (payload.taxMode === "INTER_STATE") {
      igstAmountPaise = taxPaise;
    }

    const snapshot = sourceLine || product;

    const item = {
      lineId,
      rfqLineId,
      productId: product._id,

      productCode: snapshot.productCode,
      productName: sourceLine ? sourceLine.productName : product.name,

      productType: sourceLine ? sourceLine.productType : product.type,

      unit: snapshot.unit,
      hsnSacCode: product.hsnSacCode || null,
      specification: text(input.specification),

      quantity: quantityMilli / 1000,
      unitRatePaise,
      discountPercent: discountBasisPoints / 100,
      gstRate,

      grossAmountPaise,
      discountAmountPaise,
      taxableAmountPaise,
      cgstAmountPaise,
      sgstAmountPaise,
      igstAmountPaise,
      totalAmountPaise: safeAmount(taxableAmountPaise + taxPaise),
    };

    for (const field of AMOUNT_FIELDS) {
      totals[field] = safeAmount(totals[field] + item[field]);
    }

    return item;
  });

  return {
    supplierReferenceNumber: text(payload.supplierReferenceNumber),
    quotationDate,
    validUntil,
    currency: "INR",
    taxMode: payload.taxMode,
    items,
    ...totals,
    paymentTerms: text(payload.paymentTerms),
    deliveryTerms: text(payload.deliveryTerms),
    termsAndConditions: text(payload.termsAndConditions),
    notes: text(payload.notes),
  };
};

/* ==========================================
   CREATE
   ========================================== */

const createQuotation = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    if (!["DIRECT", "RFQ"].includes(payload.creationMode)) {
      throw createError("Invalid creation mode");
    }

    const supplierId = await validateSupplier(context, payload.supplierId);

    let rfq = null;

    if (payload.creationMode === "RFQ") {
      if (
        !Number.isSafeInteger(payload.sourceRfqVersion) ||
        payload.sourceRfqVersion < 0
      ) {
        throw createError("Source RFQ version is required");
      }

      rfq = await lockRfq(
        context,
        payload.sourceRfqId,
        supplierId,
        payload.sourceRfqVersion,
      );
    } else if (
      hasOwn(payload, "sourceRfqId") ||
      hasOwn(payload, "sourceRfqVersion")
    ) {
      throw createError("DIRECT quotations cannot contain RFQ references");
    }

    const data = await calculate(context, payload, rfq);

    const quotationNumber = await getNextSequence(
      "SQ",
      String(context.tenantId),
      3,
      {
        connection: context.connection,
        session: context.session,
      },
    );

    const [document] = await context.models.SupplierQuotation.create(
      [
        {
          ...data,
          tenantId: context.tenantId,
          quotationNumber,
          creationMode: payload.creationMode,
          supplierId,
          sourceRfqId: rfq?._id || null,
          sourceRfqNumber: rfq?.rfqNumber || null,
          reservesRfqSupplier: Boolean(rfq),
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

const getQuotation = async (args) => {
  const context = resolveContext(args);
  return (await loadQuotation(context)).toObject();
};

const listQuotations = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const {
    page = 1,
    limit = 20,
    search,
    status,
    creationMode,
    supplierId,
    sourceRfqId,
  } = args;

  const filter = { tenantId, isDeleted: false };

  if (status) filter.status = status;
  if (creationMode) filter.creationMode = creationMode;

  if (supplierId) {
    filter.supplierId = objectId(supplierId, "supplierId");
  }

  if (sourceRfqId) {
    filter.sourceRfqId = objectId(sourceRfqId, "sourceRfqId");
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { quotationNumber: regex },
      { supplierReferenceNumber: regex },
      { sourceRfqNumber: regex },
    ];
  }

  const [data, total] = await Promise.all([
    models.SupplierQuotation.find(filter)
      .sort({ quotationDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    models.SupplierQuotation.countDocuments(filter),
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

const updateQuotation = (args) =>
  transaction(args, async (context) => {
    const document = await loadQuotation(context);
    const payload = args.payload || {};

    assertVersion(document, payload.version);

    if (document.status !== "CREATED") {
      throw createError("Only CREATED quotations can be edited", 409);
    }

    await assertNoActivePurchaseOrder(context, document._id);

    await validateSupplier(context, document.supplierId);

    const rfq =
      document.creationMode === "RFQ"
        ? await lockRfq(context, document.sourceRfqId, document.supplierId)
        : null;

    const oldData = document.toObject();
    const merged = {};

    for (const field of EDITABLE_FIELDS) {
      merged[field] = hasOwn(payload, field) ? payload[field] : oldData[field];
    }

    const data = await calculate(context, merged, rfq, document);

    document.set({
      ...data,
      updatedBy: context.userId,
    });

    await document.save({
      session: context.session,
    });

    await audit(context, document, "UPDATE", oldData);

    return document.toObject();
  });

/* ==========================================
   CANCEL / DELETE
   ========================================== */

const removeQuotation = (args, softDelete) =>
  transaction(args, async (context) => {
    const document = await loadQuotation(context);
    const payload = args.payload || {};

    assertVersion(document, payload.version);

    if (document.status !== "CREATED") {
      throw createError(
        "Only CREATED quotations can be cancelled or deleted",
        409,
      );
    }

    await assertNoActivePurchaseOrder(context, document._id);

    if (document.creationMode === "RFQ") {
      await lockRfq(context, document.sourceRfqId, document.supplierId);
    }

    const cancellationReason = text(payload.cancellationReason);

    if (!softDelete && !cancellationReason) {
      throw createError("Cancellation reason is required");
    }

    const oldData = document.toObject();

    document.updatedBy = context.userId;
    document.reservesRfqSupplier = false;

    if (softDelete) {
      document.isDeleted = true;
      document.deletedAt = new Date();
      document.deletedBy = context.userId;
    } else {
      document.status = "CANCELLED";
      document.cancelledAt = new Date();
      document.cancelledBy = context.userId;
      document.cancellationReason = cancellationReason;
    }

    await document.save({
      session: context.session,
    });

    await audit(context, document, softDelete ? "DELETE" : "CANCEL", oldData);

    return softDelete ? null : document.toObject();
  });
module.exports = {
  createQuotation,
  getQuotation,
  listQuotations,
  updateQuotation,
  cancelQuotation: (args) => removeQuotation(args, false),
  deleteQuotation: (args) => removeQuotation(args, true),
  calculateQuotationData: calculate,
};
