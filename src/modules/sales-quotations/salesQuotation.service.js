const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

// const getNextSequence = require("../../utils/sequenceGenerator");
const { getNextSequence } = require("../../utils/sequenceGenerator");

const QUOTATION_STATUSES = [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
];

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const normalizeOptionalText = (value) => {
  const text = normalizeText(value);
  return text || null;
};

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return value;
};

const assertSafeAmount = (value, fieldName) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${fieldName} exceeds the supported range`);
  }

  return value;
};

const addAmounts = (first, second) => {
  assertSafeAmount(first, "Amount");
  assertSafeAmount(second, "Amount");

  return first + second;
};

// Exact integer calculation with half-up rounding.
const multiplyDivide = (first, second, divisor) => {
  assertSafeAmount(first, "Amount");
  assertSafeAmount(second, "Amount");

  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw createError("Invalid calculation divisor");
  }

  const numerator = BigInt(first) * BigInt(second);
  const denominator = BigInt(divisor);
  const rounded = (numerator + denominator / 2n) / denominator;

  return assertSafeAmount(Number(rounded), "Amount");
};

const scaledNumber = ({ value, scale, minimum, maximum, fieldName }) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError(`${fieldName} must be a valid number`);
  }

  if (value < minimum || value > maximum) {
    throw createError(`${fieldName} must be between ${minimum} and ${maximum}`);
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
    throw createError(`${fieldName} has too many decimal places`);
  }

  return integer;
};

const assertVersion = (document, expectedVersion) => {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw createError("A valid version is required");
  }

  if (document.__v !== expectedVersion) {
    throw createError(
      "This quotation was updated by another user. Refresh and try again.",
      409,
    );
  }
};

const getCustomer = async (Customer, tenantId, customerId, session) => {
  validateObjectId(customerId, "customerId");

  const customer = await Customer.findOne({
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

  return customer;
};

const getProducts = async (Product, tenantId, items, session) => {
  const productIds = [
    ...new Set(
      items.map((item) => validateObjectId(item.productId, "productId")),
    ),
  ];

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more products are missing, inactive, or belong to another tenant",
      404,
    );
  }

  return new Map(products.map((product) => [String(product._id), product]));
};

const calculateQuotation = async ({
  models,
  tenantId,
  payload,
  existingQuotation = null,
  session,
}) => {
  const { Customer, Product } = models;

  const customerId = payload.customerId ?? existingQuotation?.customerId;

  const customer = await getCustomer(Customer, tenantId, customerId, session);

  const quotationDate = new Date(
    payload.quotationDate ?? existingQuotation.quotationDate,
  );

  const validUntil = new Date(
    payload.validUntil ?? existingQuotation.validUntil,
  );

  const expectedDeliveryDate =
    payload.expectedDeliveryDate !== undefined
      ? normalizeOptionalText(payload.expectedDeliveryDate)
        ? new Date(payload.expectedDeliveryDate)
        : null
      : (existingQuotation?.expectedDeliveryDate ?? null);

  if (
    Number.isNaN(quotationDate.getTime()) ||
    Number.isNaN(validUntil.getTime())
  ) {
    throw createError("Valid quotation and validity dates are required");
  }

  if (validUntil < quotationDate) {
    throw createError("Validity date cannot be before quotation date");
  }

  if (expectedDeliveryDate && expectedDeliveryDate < quotationDate) {
    throw createError("Expected delivery date cannot be before quotation date");
  }

  const taxMode = payload.taxMode ?? existingQuotation?.taxMode;

  if (!["NONE", "INTRA_STATE", "INTER_STATE"].includes(taxMode)) {
    throw createError("A valid tax mode is required");
  }

  const inputItems = payload.items ?? existingQuotation.items;

  if (
    !Array.isArray(inputItems) ||
    inputItems.length < 1 ||
    inputItems.length > 200
  ) {
    throw createError("A quotation requires between 1 and 200 items");
  }

  const productMap = await getProducts(Product, tenantId, inputItems, session);

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const items = [];

  for (const input of inputItems) {
    const product = productMap.get(String(input.productId));

    if (!product) {
      throw createError(
        "Product details changed. Refresh the quotation and try again.",
        409,
      );
    }

    const quantityMilli = scaledNumber({
      value: input.quantity,
      scale: 1000,
      minimum: 0.001,
      maximum: 1000000,
      fieldName: `Quantity for ${product.name}`,
    });

    const discountBasisPoints = scaledNumber({
      value: input.discountPercent ?? 0,
      scale: 100,
      minimum: 0,
      maximum: 100,
      fieldName: `Discount for ${product.name}`,
    });

    const unitRatePaise = assertSafeAmount(
      input.unitRatePaise,
      `Unit rate for ${product.name}`,
    );

    const gstRate = input.gstRate;

    if (![0, 3, 5, 12, 18, 28].includes(gstRate)) {
      throw createError(`Invalid GST rate for ${product.name}`);
    }

    if (taxMode === "NONE" && gstRate !== 0) {
      throw createError(
        `GST rate must be zero for ${product.name} when tax mode is NONE`,
      );
    }

    if (taxMode === "INTRA_STATE" && gstRate !== 0 && gstRate % 2 !== 0) {
      throw createError(
        `Intra-state GST rate must be evenly split for ${product.name}`,
      );
    }

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

    if (taxMode === "INTRA_STATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);
      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (taxMode === "INTER_STATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const totalAmountPaise = addAmounts(taxableAmountPaise, taxAmountPaise);

    const item = {
      lineId:
        input.lineId && mongoose.isObjectIdOrHexString(input.lineId)
          ? new mongoose.Types.ObjectId(input.lineId)
          : new mongoose.Types.ObjectId(),

      productId: product._id,
      productCode: product.productCode,
      productName: product.name,
      productType: product.type,
      unit: product.unit,
      hsnSacCode: product.hsnSacCode || null,
      specification: normalizeOptionalText(input.specification),

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

      totalAmountPaise,
    };

    items.push(item);

    for (const field of AMOUNT_FIELDS) {
      totals[field] = addAmounts(totals[field], item[field]);
    }
  }

  return {
    customerId: customer._id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    customerGstNo: customer.gstNo || null,
    billingAddress: normalizeOptionalText(
      payload.billingAddress ?? customer.billingAddress,
    ),
    shippingAddress: normalizeOptionalText(
      payload.shippingAddress ?? customer.shippingAddress,
    ),

    quotationDate,
    validUntil,
    expectedDeliveryDate,

    deliveryTerms: normalizeOptionalText(
      payload.deliveryTerms ?? existingQuotation?.deliveryTerms,
    ),

    paymentTerms: normalizeText(
      payload.paymentTerms ?? existingQuotation?.paymentTerms,
    ),

    taxMode,
    items,
    ...totals,

    notes: normalizeOptionalText(payload.notes ?? existingQuotation?.notes),

    termsAndConditions: normalizeOptionalText(
      payload.termsAndConditions ?? existingQuotation?.termsAndConditions,
    ),
  };
};

const createAudit = async ({
  AuditLog,
  tenantId,
  userId,
  action,
  quotation,
  oldData = null,
  ipAddress,
  session,
}) => {
  await AuditLog.create(
    [
      {
        tenantId,
        userId,
        action,
        module: "SALESQUOTATION",
        documentId: quotation._id,
        oldData,
        newData: quotation.toObject(),
        ipAddress,
      },
    ],
    { session, ordered: true },
  );
};

const translateDuplicateError = (error) => {
  if (error?.code === 11000) {
    return createError("Quotation revision already exists", 409);
  }

  return error;
};

const getQuotationForUpdate = async ({
  SalesQuotation,
  tenantId,
  quotationId,
  session,
}) => {
  validateObjectId(quotationId, "quotationId");

  const quotation = await SalesQuotation.findOne({
    _id: quotationId,
    tenantId,
    isDeleted: false,
  }).session(session);

  if (!quotation) {
    throw createError("Sales quotation not found", 404);
  }

  return quotation;
};

const createQuotation = async ({ tenant, userId, payload, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation, AuditLog } = models;

  const tenantId = tenant._id ?? tenant.id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const quotationData = await calculateQuotation({
        models,
        tenantId,
        payload,
        session,
      });

      // const quotationNumber = await getNextSequence("SQ", tenantId.toString());
      const quotationNumber = await getNextSequence(
        "SQ",
        tenantId.toString(),
        3,
        {
          connection,
          session,
        },
      );

      const records = await SalesQuotation.create(
        [
          {
            ...quotationData,
            tenantId,
            quotationNumber,
            quotationFamilyId: new mongoose.Types.ObjectId(),
            revision: 1,
            previousRevisionId: null,
            comparisonGroupId: payload.comparisonGroupId
              ? new mongoose.Types.ObjectId(payload.comparisonGroupId)
              : new mongoose.Types.ObjectId(),

            enquiryReference: normalizeOptionalText(payload.enquiryReference),

            status: "DRAFT",
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );

      const quotation = records[0];

      await createAudit({
        AuditLog,
        tenantId,
        userId,
        action: "CREATE",
        quotation,
        ipAddress,
        session,
      });

      result = quotation.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const updateDraftQuotation = async ({
  tenant,
  userId,
  quotationId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation, AuditLog } = models;

  const tenantId = tenant._id ?? tenant.id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const quotation = await getQuotationForUpdate({
        SalesQuotation,
        tenantId,
        quotationId,
        session,
      });

      assertVersion(quotation, payload.version);

      if (quotation.status !== "DRAFT") {
        throw createError("Only draft quotations can be edited", 409);
      }

      const oldData = quotation.toObject();

      const quotationData = await calculateQuotation({
        models,
        tenantId,
        payload,
        existingQuotation: quotation,
        session,
      });

      quotation.set({
        ...quotationData,
        enquiryReference:
          payload.enquiryReference !== undefined
            ? normalizeOptionalText(payload.enquiryReference)
            : quotation.enquiryReference,

        comparisonGroupId:
          payload.comparisonGroupId !== undefined
            ? new mongoose.Types.ObjectId(payload.comparisonGroupId)
            : quotation.comparisonGroupId,

        updatedBy: userId,
      });

      await quotation.save({
        session,
      });

      await createAudit({
        AuditLog,
        tenantId,
        userId,
        action: "UPDATE",
        quotation,
        oldData,
        ipAddress,
        session,
      });

      result = quotation.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const issueQuotation = async ({
  tenant,
  userId,
  quotationId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation, AuditLog } = models;

  const tenantId = tenant._id ?? tenant.id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const quotation = await getQuotationForUpdate({
        SalesQuotation,
        tenantId,
        quotationId,
        session,
      });

      assertVersion(quotation, payload.version);

      if (quotation.status !== "DRAFT") {
        throw createError("Only a draft quotation can be issued", 409);
      }

      if (quotation.totalAmountPaise <= 0) {
        throw createError(
          "A quotation must have a positive total before it can be issued",
          409,
        );
      }

      const activeIssue = await SalesQuotation.findOne({
        tenantId,
        quotationFamilyId: quotation.quotationFamilyId,
        status: {
          $in: ["ISSUED", "ACCEPTED"],
        },
        _id: {
          $ne: quotation._id,
        },
      })
        .session(session)
        .select("_id")
        .lean();

      if (activeIssue) {
        throw createError(
          "Another revision of this quotation is already issued or accepted",
          409,
        );
      }

      const oldData = quotation.toObject();

      quotation.status = "ISSUED";
      quotation.issuedAt = new Date();
      quotation.issuedBy = userId;
      quotation.updatedBy = userId;

      await quotation.save({ session });

      await createAudit({
        AuditLog,
        tenantId,
        userId,
        action: "ISSUE",
        quotation,
        oldData,
        ipAddress,
        session,
      });

      result = quotation.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const createRevision = async ({
  tenant,
  userId,
  quotationId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation, AuditLog } = models;

  const tenantId = tenant._id ?? tenant.id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const previousQuotation = await getQuotationForUpdate({
        SalesQuotation,
        tenantId,
        quotationId,
        session,
      });

      assertVersion(previousQuotation, payload.version);

      if (previousQuotation.status === "CANCELLED") {
        throw createError("A cancelled quotation cannot be revised", 409);
      }

      const latestRevision = await SalesQuotation.findOne({
        tenantId,
        quotationFamilyId: previousQuotation.quotationFamilyId,
      })
        .sort({ revision: -1 })
        .session(session)
        .lean();

      if (String(latestRevision._id) !== String(previousQuotation._id)) {
        throw createError("This quotation is not the latest revision", 409);
      }

      const quotationData = await calculateQuotation({
        models,
        tenantId,
        payload,
        existingQuotation: previousQuotation,
        session,
      });

      const records = await SalesQuotation.create(
        [
          {
            ...quotationData,

            tenantId,
            quotationNumber: previousQuotation.quotationNumber,
            quotationFamilyId: previousQuotation.quotationFamilyId,
            comparisonGroupId: previousQuotation.comparisonGroupId,

            revision: previousQuotation.revision + 1,

            previousRevisionId: previousQuotation._id,

            enquiryReference:
              payload.enquiryReference !== undefined
                ? normalizeOptionalText(payload.enquiryReference)
                : previousQuotation.enquiryReference,

            revisionReason: normalizeOptionalText(payload.revisionReason),

            status: "DRAFT",
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );

      const revision = records[0];

      previousQuotation.supersededById = revision._id;
      previousQuotation.supersededAt = new Date();
      previousQuotation.updatedBy = userId;

      await previousQuotation.save({
        session,
      });

      await createAudit({
        AuditLog,
        tenantId,
        userId,
        action: "CREATE_REVISION",
        quotation: revision,
        oldData: null,
        ipAddress,
        session,
      });

      result = revision.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const transitionQuotation = async ({
  tenant,
  userId,
  quotationId,
  payload,
  ipAddress,
  fromStatus,
  toStatus,
  action,
  timestampField,
  userField,
  reasonField,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation, AuditLog } = models;

  const tenantId = tenant._id ?? tenant.id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const quotation = await getQuotationForUpdate({
        SalesQuotation,
        tenantId,
        quotationId,
        session,
      });

      assertVersion(quotation, payload.version);

      if (quotation.status !== fromStatus) {
        throw createError(
          `Only a ${fromStatus.toLowerCase()} quotation can be ${action.toLowerCase()}d`,
          409,
        );
      }

      if (toStatus === "ACCEPTED" && quotation.validUntil < new Date()) {
        throw createError("This quotation has expired", 409);
      }

      const oldData = quotation.toObject();

      quotation.status = toStatus;
      quotation[timestampField] = new Date();
      quotation[userField] = userId;

      if (reasonField) {
        quotation[reasonField] = normalizeOptionalText(payload[reasonField]);
      }

      quotation.updatedBy = userId;

      await quotation.save({ session });

      await createAudit({
        AuditLog,
        tenantId,
        userId,
        action,
        quotation,
        oldData,
        ipAddress,
        session,
      });

      result = quotation.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const acceptQuotation = (context) =>
  transitionQuotation({
    ...context,
    fromStatus: "ISSUED",
    toStatus: "ACCEPTED",
    action: "ACCEPT",
    timestampField: "acceptedAt",
    userField: "acceptedBy",
    reasonField: "acceptanceReference",
  });

const rejectQuotation = (context) =>
  transitionQuotation({
    ...context,
    fromStatus: "ISSUED",
    toStatus: "REJECTED",
    action: "REJECT",
    timestampField: "rejectedAt",
    userField: "rejectedBy",
    reasonField: "rejectionReason",
  });

const cancelQuotation = (context) =>
  transitionQuotation({
    ...context,
    fromStatus: "DRAFT",
    toStatus: "CANCELLED",
    action: "CANCEL",
    timestampField: "cancelledAt",
    userField: "cancelledBy",
    reasonField: "cancellationReason",
  });

const deleteDraftQuotation = async ({
  tenant,
  userId,
  quotationId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation, AuditLog } = models;

  const tenantId = tenant._id ?? tenant.id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const quotation = await getQuotationForUpdate({
        SalesQuotation,
        tenantId,
        quotationId,
        session,
      });

      assertVersion(quotation, payload.version);

      if (quotation.status !== "DRAFT") {
        throw createError("Only draft quotations can be deleted", 409);
      }

      const oldData = quotation.toObject();

      quotation.isDeleted = true;
      quotation.deletedAt = new Date();
      quotation.deletedBy = userId;
      quotation.updatedBy = userId;

      await quotation.save({ session });

      await createAudit({
        AuditLog,
        tenantId,
        userId,
        action: "DELETE",
        quotation,
        oldData,
        ipAddress,
        session,
      });

      result = quotation.toObject();
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addQuotationConversionStatus = async ({
  SalesQuotation,
  SalesOrder,
  tenantId,
  quotations,
}) => {
  if (!quotations.length) {
    return [];
  }

  const groupIds = [
    ...new Set(
      quotations
        .map((quotation) =>
          quotation.comparisonGroupId
            ? String(quotation.comparisonGroupId)
            : null,
        )
        .filter(Boolean),
    ),
  ];

  /*
   * Include every revision in these groups, even
   * deleted quotation records, so an active order
   * from an older revision is not missed.
   */
  const groupMembers = groupIds.length
    ? await SalesQuotation.find({
        tenantId,
        comparisonGroupId: {
          $in: groupIds,
        },
      })
        .select("_id comparisonGroupId")
        .lean()
    : [];

  const sourceIds = [
    ...new Set([
      ...quotations.map((quotation) => String(quotation._id)),

      ...groupMembers.map((quotation) => String(quotation._id)),
    ]),
  ];

  const orders = await SalesOrder.find({
    tenantId,

    sourceQuotationId: {
      $in: sourceIds,
    },

    isDeleted: false,
    status: { $ne: "CANCELLED" },
  })
    .sort({ createdAt: 1, _id: 1 })
    .select("_id orderNumber status sourceQuotationId")
    .lean();

  const groupByQuotation = new Map(
    groupMembers.map((quotation) => [
      String(quotation._id),
      String(quotation.comparisonGroupId),
    ]),
  );

  const orderByQuotation = new Map();
  const orderByGroup = new Map();

  for (const order of orders) {
    const sourceId = String(order.sourceQuotationId);

    if (!orderByQuotation.has(sourceId)) {
      orderByQuotation.set(sourceId, order);
    }

    const groupId = groupByQuotation.get(sourceId);

    if (groupId && !orderByGroup.has(groupId)) {
      orderByGroup.set(groupId, order);
    }
  }

  return quotations.map((quotation) => {
    const directOrder = orderByQuotation.get(String(quotation._id)) || null;

    const groupOrder = quotation.comparisonGroupId
      ? orderByGroup.get(String(quotation.comparisonGroupId)) || null
      : null;

    return {
      ...quotation,

      conversionStatus: directOrder
        ? "CONVERTED"
        : groupOrder
          ? "COMPARISON_CLOSED"
          : "OPEN",

      existingOrder: directOrder,
      groupExistingOrder: groupOrder,
    };
  });
};const getQuotations = async ({
  tenant,
  query = {},
}) => {
  const connection =
    getReadyTenantConnection(tenant);

  const models =
    getTenantAccountingModels(connection);

  const {
    SalesQuotation,
    SalesOrder,
  } = models;

  const tenantId =
    tenant._id ?? tenant.id;

  const page = Math.max(
    Math.floor(Number(query.page) || 1),
    1,
  );

  const limit = Math.min(
    Math.max(
      Math.floor(Number(query.limit) || 20),
      1,
    ),
    100,
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (query.customerId) {
    filter.customerId =
      query.customerId;
  }

  if (query.status) {
    filter.status =
      query.status;
  }

  if (query.comparisonGroupId) {
    filter.comparisonGroupId =
      query.comparisonGroupId;
  }

  if (query.quotationFamilyId) {
    filter.quotationFamilyId =
      query.quotationFamilyId;
  }

  if (
    query.validUntilFrom ||
    query.validUntilTo
  ) {
    filter.validUntil = {};

    if (query.validUntilFrom) {
      filter.validUntil.$gte =
        new Date(query.validUntilFrom);
    }

    if (query.validUntilTo) {
      filter.validUntil.$lte =
        new Date(query.validUntilTo);
    }
  }

  const searchText =
    normalizeText(query.search);

  if (searchText) {
    const regex = new RegExp(
      escapeRegex(searchText),
      "i",
    );

    filter.$or = [
      {
        quotationNumber: regex,
      },
      {
        customerName: regex,
      },
      {
        customerCode: regex,
      },
      {
        enquiryReference: regex,
      },
    ];
  }

  // First fetch the quotation page and total count.
  const [data, total] = await Promise.all([
    SalesQuotation.find(filter)
      .sort({
        quotationDate: -1,
        createdAt: -1,
        _id: -1,
      })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    SalesQuotation.countDocuments(filter),
  ]);

  // Then enrich the fetched quotations.
  const enrichedData =
    await addQuotationConversionStatus({
      SalesQuotation,
      SalesOrder,
      tenantId,
      quotations: data,
    });

  return {
    data: enrichedData,

    pagination: {
      page,
      limit,
      total,
      totalPages:
        Math.ceil(total / limit),
    },
  };
};
const getQuotationById = async ({ tenant, quotationId }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesQuotation } = models;

  const tenantId = tenant._id ?? tenant.id;

  validateObjectId(quotationId, "quotationId");

  const quotation = await SalesQuotation.findOne({
    _id: quotationId,
    tenantId,
    isDeleted: false,
  }).lean();

  if (!quotation) {
    throw createError("Sales quotation not found", 404);
  }

  return quotation;
};
const compareQuotations = async ({ tenant, comparisonGroupId }) => {
  validateObjectId(comparisonGroupId, "comparisonGroupId");

  const connection = getReadyTenantConnection(tenant);

  const { SalesQuotation, SalesOrder } = getTenantAccountingModels(connection);

  const tenantId = tenant._id ?? tenant.id;

  /*
   * Fetch every revision, including deleted ones,
   * so existing orders are not missed.
   */
  const allQuotations = await SalesQuotation.find({
    tenantId,
    comparisonGroupId,
  })
    .sort({
      quotationFamilyId: 1,
      revision: -1,
      _id: -1,
    })
    .lean();

  if (!allQuotations.length) {
    throw createError("Comparison group not found", 404);
  }

  const latestByFamily = new Map();

  for (const quotation of allQuotations) {
    if (quotation.isDeleted) {
      continue;
    }

    const familyKey = String(quotation.quotationFamilyId || quotation._id);

    if (!latestByFamily.has(familyKey)) {
      latestByFamily.set(familyKey, quotation);
    }
  }

  const existingOrders = await SalesOrder.find({
    tenantId,

    sourceQuotationId: {
      $in: allQuotations.map((quotation) => quotation._id),
    },

    isDeleted: false,
    status: { $ne: "CANCELLED" },
  })
    .sort({ createdAt: 1, _id: 1 })
    .select("_id orderNumber status sourceQuotationId")
    .lean();

  const groupExistingOrder = existingOrders[0] || null;

  const quotationsById = new Map(
    allQuotations.map((quotation) => [String(quotation._id), quotation]),
  );

  const sourceQuotation = groupExistingOrder
    ? quotationsById.get(String(groupExistingOrder.sourceQuotationId))
    : null;

  const comparisonOrder = groupExistingOrder
    ? {
        ...groupExistingOrder,

        customerName: sourceQuotation?.customerName || null,

        quotationNumber: sourceQuotation?.quotationNumber || null,

        revision: sourceQuotation?.revision || null,
      }
    : null;

  const ordersBySource = new Map(
    existingOrders.map((order) => [String(order.sourceQuotationId), order]),
  );

  return {
    comparisonGroupId: String(comparisonGroupId),

    conversionClosed: Boolean(comparisonOrder),

    groupExistingOrder: comparisonOrder,

    activeOrderCount: existingOrders.length,

    quotations: Array.from(latestByFamily.values()).map((quotation) => {
      const existingOrder = ordersBySource.get(String(quotation._id)) || null;

      const eligibleStatus = ["DRAFT", "ISSUED", "ACCEPTED"].includes(
        quotation.status,
      );

      return {
        ...quotation,

        existingOrder,

        canConvert: eligibleStatus && !comparisonOrder,

        conversionBlockedReason: comparisonOrder
          ? `Sales Order ${comparisonOrder.orderNumber} already exists for this comparison`
          : !eligibleStatus
            ? "This quotation is not eligible for conversion"
            : null,
      };
    }),
  };
};
const getQuotationByNumber = async ({ tenant, quotationNumber, revision }) => {
  const normalizedNumber = String(quotationNumber ?? "")
    .trim()
    .toUpperCase();

  const revisionNumber = Number(revision);

  if (!normalizedNumber || normalizedNumber.length > 100) {
    throw createError("A valid quotation number is required");
  }

  if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
    throw createError("A valid quotation revision is required");
  }

  const connection = getReadyTenantConnection(tenant);

  const { SalesQuotation } = getTenantAccountingModels(connection);

  const tenantId = tenant._id ?? tenant.id;

  const quotation = await SalesQuotation.findOne({
    tenantId,
    quotationNumber: normalizedNumber,
    revision: revisionNumber,
    isDeleted: false,
  }).lean();

  if (!quotation) {
    throw createError("Sales quotation revision not found", 404);
  }

  return quotation;
};

module.exports = {
  createQuotation,
  updateDraftQuotation,
  issueQuotation,
  createRevision,
  acceptQuotation,
  rejectQuotation,
  cancelQuotation,
  deleteDraftQuotation,
  getQuotations,
  getQuotationById,
  compareQuotations,
  getQuotationByNumber,
};
