const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const GST_RATES = [0, 3, 5, 12, 18, 28];

const TAX_MODES = ["NONE", "INTRA_STATE", "INTER_STATE"];

const ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
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

const EDITABLE_FIELDS = [
  "orderDate",
  "expectedDeliveryDate",
  "billingAddress",
  "shippingAddress",
  "taxMode",
  "paymentTerms",
  "deliveryTerms",
  "items",
  "notes",
  "termsAndConditions",
];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const normalizeCode = (value) => normalizeText(value)?.toUpperCase() || null;

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const assertSafeAmount = (value, fieldName = "Amount") => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${fieldName} must be a non-negative safe integer`);
  }

  return value;
};

const addAmounts = (first, second) => assertSafeAmount(first + second);

const multiplyDivide = (first, second, divisor) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw createError("Invalid calculation divisor");
  }

  const numerator = BigInt(first) * BigInt(second);
  const denominator = BigInt(divisor);

  return assertSafeAmount(Number((numerator + denominator / 2n) / denominator));
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

const rupeesToPaise = (value, fieldName) =>
  scaledNumber({
    value,
    scale: 100,
    minimum: 0,
    maximum: 1000000000,
    fieldName,
  });

const parseDate = (value, fieldName) => {
  if (!value || !(typeof value === "string" || value instanceof Date)) {
    throw createError(`${fieldName} is required`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const optionalDate = (value, fieldName) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return parseDate(value, fieldName);
};

const localDateString = () => {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertVersion = (order, version) => {
  // Backward-compatible while existing controllers
  // do not yet pass a version.
  if (version === undefined) {
    return;
  }

  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError("Version must be a non-negative integer");
  }

  if (order.__v !== version) {
    throw createError(
      "Sales order has changed. Reload it before continuing.",
      409,
    );
  }
};

const translateError = (error) => {
  if (error?.code === 11000) {
    return createError(
      "A duplicate Sales Order number or unique reference already exists",
      409,
    );
  }

  if (error?.name === "VersionError") {
    return createError(
      "Sales order has changed. Reload it before continuing.",
      409,
    );
  }

  return error;
};

const resolveContext = (args) => {
  const { tenant } = args || {};

  if (!tenant?._id) {
    throw createError(
      "Resolved tenant context is required for Sales Orders",
      500,
    );
  }

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "SalesOrder",
    "SalesQuotation",
    "Customer",
    "Product",
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
    tenantId: validateObjectId(tenant._id, "tenantId"),
    connection,
    models,
  };
};

const runTransaction = async (args, operation) => {
  const context = resolveContext(args);

  context.userId = validateObjectId(args.userId, "userId");

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

const getCustomer = async ({ models, tenantId, customerId, session }) => {
  const customer = await models.Customer.findOne({
    _id: validateObjectId(customerId, "customerId"),
    tenantId,
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (!customer) {
    throw createError("Customer not found in the current tenant database", 404);
  }

  if (customer.status !== "Active") {
    throw createError("The selected customer is inactive", 409);
  }

  return customer;
};

// const getAcceptedQuotation = async ({
//   models,
//   tenantId,
//   quotationId,
//   customerId,
//   session,
// }) => {
//   const quotation =
//     await models.SalesQuotation.findOne({
//       _id: validateObjectId(
//         quotationId,
//         "sourceQuotationId",
//       ),
//       tenantId,
//       isDeleted: false,
//       status: "ACCEPTED",
//     })
//       .session(session)
//       .lean();

//   if (!quotation) {
//     throw createError(
//       "Accepted sales quotation not found",
//       404,
//     );
//   }

//   if (
//     customerId &&
//     String(quotation.customerId) !== String(customerId)
//   ) {
//     throw createError(
//       "Sales order customer must match the source quotation customer",
//       409,
//     );
//   }

//   return quotation;
// };
const getAcceptedQuotation = async ({
  models,
  tenantId,
  quotationId,
  customerId,
  session,
}) => {
  const quotation = await models.SalesQuotation.findOne({
    _id: validateObjectId(quotationId, "sourceQuotationId"),
    tenantId,
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (!quotation) {
    throw createError("Source quotation not found", 404);
  }

  const eligibleStatuses = ["DRAFT", "ISSUED", "ACCEPTED"];

  if (!eligibleStatuses.includes(quotation.status)) {
    throw createError(
      "Cancelled or rejected quotations cannot be used for this order",
      409,
    );
  }

  if (customerId && String(quotation.customerId) !== String(customerId)) {
    throw createError(
      "Sales order customer must match the source quotation customer",
      409,
    );
  }

  return quotation;
};
const ensureNoExistingConversion = async ({
  models,
  tenantId,
  quotationId,
  excludeOrderId,
  session,
}) => {
  const quotation = await models.SalesQuotation.findOne({
    _id: validateObjectId(quotationId, "quotationId"),
    tenantId,
  })
    .session(session)
    .select("_id comparisonGroupId quotationFamilyId")
    .lean();

  if (!quotation) {
    throw createError("Source quotation not found", 404);
  }

  const groupId = quotation.comparisonGroupId;

  /*
   * Old records without a comparison group are
   * protected at quotation-family level instead.
   */
  const scopeKey = groupId
    ? `group_${String(groupId)}`
    : `family_${String(quotation.quotationFamilyId || quotation._id)}`;

  /*
   * A shared transaction write serializes order
   * creation for every offer in this comparison.
   *
   * Use the tenant connection, not mongoose.connection.
   */
  const counters = models.SalesOrder.db.db.collection("counters");

  await counters.updateOne(
    {
      _id: `${String(tenantId)}_` + `QUOTATION_ORDER_LOCK_${scopeKey}`,
    },
    {
      $inc: { seq: 1 },
    },
    {
      upsert: true,
      session,
    },
  );

  const sourceFilter = {
    tenantId,
  };

  if (groupId) {
    sourceFilter.comparisonGroupId = groupId;
  } else if (quotation.quotationFamilyId) {
    sourceFilter.quotationFamilyId = quotation.quotationFamilyId;
  } else {
    sourceFilter._id = quotation._id;
  }

  /*
   * Include old and deleted quotation revisions.
   * Their active orders must still block another
   * order for this comparison.
   */
  const groupQuotations = await models.SalesQuotation.find(sourceFilter)
    .session(session)
    .select("_id")
    .lean();

  const orderFilter = {
    tenantId,

    sourceQuotationId: {
      $in: groupQuotations.map((record) => record._id),
    },

    isDeleted: false,
    status: { $ne: "CANCELLED" },
  };

  if (excludeOrderId) {
    orderFilter._id = {
      $ne: excludeOrderId,
    };
  }

  const existingOrder = await models.SalesOrder.findOne(orderFilter)
    .session(session)
    .select("_id orderNumber status sourceQuotationId")
    .lean();

  if (existingOrder) {
    throw createError(
      `This comparison already has Sales Order ${existingOrder.orderNumber}. Another customer offer cannot be converted.`,
      409,
    );
  }
};

const calculateOrder = async ({
  models,
  tenantId,
  payload,
  existingOrder = null,
  session,
}) => {
  const customer = await getCustomer({
    models,
    tenantId,
    customerId: payload.customerId,
    session,
  });

  const orderDate = parseDate(payload.orderDate, "Order date");

  const expectedDeliveryDate = optionalDate(
    payload.expectedDeliveryDate,
    "Expected delivery date",
  );

  if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
    throw createError("Expected delivery date cannot be before order date");
  }

  if (!TAX_MODES.includes(payload.taxMode)) {
    throw createError("Invalid tax mode");
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("A sales order requires between 1 and 200 items");
  }

  let quotation = null;

  if (payload.sourceQuotationId) {
    quotation = await getAcceptedQuotation({
      models,
      tenantId,
      quotationId: payload.sourceQuotationId,
      customerId: customer._id,
      session,
    });
  }

  const quotationLineMap = new Map(
    (quotation?.items || []).map((item) => [String(item.lineId), item]),
  );

  const productIds = [
    ...new Set(
      payload.items.map((item) =>
        validateObjectId(item.productId, "productId").toString(),
      ),
    ),
  ];

  const products = await models.Product.find({
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
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const existingLineMap = new Map(
    (existingOrder?.items || []).map((item) => [String(item.lineId), item]),
  );

  const seenLineIds = new Set();
  const seenQuotationLineIds = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const items = [];

  for (const [index, input] of payload.items.entries()) {
    const label = `Item ${index + 1}`;

    const productId = validateObjectId(input.productId, `${label} productId`);

    const product = productMap.get(String(productId));

    const lineId = input.lineId
      ? validateObjectId(input.lineId, `${label} lineId`)
      : new mongoose.Types.ObjectId();

    const lineKey = String(lineId);

    if (seenLineIds.has(lineKey)) {
      throw createError(`${label} lineId must be unique`);
    }

    seenLineIds.add(lineKey);

    const previousLine = existingLineMap.get(lineKey);

    if (previousLine && String(previousLine.productId) !== String(productId)) {
      throw createError(
        `${label} cannot reuse an existing lineId for a different product`,
        409,
      );
    }

    let quotationLineId = null;

    if (quotation) {
      if (!input.quotationLineId) {
        throw createError(`${label} must reference a source quotation line`);
      }

      quotationLineId = validateObjectId(
        input.quotationLineId,
        `${label} quotationLineId`,
      );

      const sourceLine = quotationLineMap.get(String(quotationLineId));

      if (!sourceLine || String(sourceLine.productId) !== String(productId)) {
        throw createError(
          `${label} does not match the source quotation product`,
          409,
        );
      }

      if (seenQuotationLineIds.has(String(quotationLineId))) {
        throw createError("A quotation line cannot appear twice in an order");
      }

      seenQuotationLineIds.add(String(quotationLineId));
    } else if (input.quotationLineId) {
      throw createError(
        `${label} cannot reference a quotation line without a source quotation`,
      );
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

    if (input.unitRatePaise !== undefined) {
      unitRatePaise = assertSafeAmount(
        input.unitRatePaise,
        `${label} unitRatePaise`,
      );

      if (unitRatePaise > 100000000000) {
        throw createError(`${label} unit rate exceeds the supported range`);
      }

      if (
        input.unitRate !== undefined &&
        rupeesToPaise(input.unitRate, `${label} unit rate`) !== unitRatePaise
      ) {
        throw createError(`${label} unitRate and unitRatePaise disagree`);
      }
    } else {
      unitRatePaise = rupeesToPaise(input.unitRate, `${label} unit rate`);
    }

    const gstRate = input.gstRate ?? product.gstRate;

    if (!GST_RATES.includes(gstRate)) {
      throw createError(`${label} GST rate is invalid`);
    }

    if (payload.taxMode === "NONE" && gstRate !== 0) {
      throw createError(`${label} GST rate must be zero when tax mode is NONE`);
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

    if (payload.taxMode === "INTRA_STATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);
      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (payload.taxMode === "INTER_STATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const item = {
      lineId,
      quotationLineId,
      productId,

      productCode: previousLine?.productCode ?? product.productCode,

      productName: previousLine?.productName ?? product.name,

      productType: previousLine?.productType ?? product.type,

      unit: previousLine?.unit ?? product.unit,

      hsnSacCode: previousLine
        ? previousLine.hsnSacCode
        : product.hsnSacCode || null,

      specification: normalizeText(input.specification),

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

      totalAmountPaise: addAmounts(taxableAmountPaise, taxAmountPaise),
    };

    items.push(item);

    for (const field of AMOUNT_FIELDS) {
      totals[field] = addAmounts(totals[field], item[field]);
    }
  }

  return {
    customerId: customer._id,

    customerCode: existingOrder?.customerCode ?? customer.customerCode,

    customerName: existingOrder?.customerName ?? customer.customerName,

    customerGstNo: existingOrder
      ? existingOrder.customerGstNo
      : customer.gstNo || null,

    sourceQuotationId: quotation?._id || null,
    sourceQuotationNumber: quotation?.quotationNumber || null,
    sourceQuotationRevision: quotation?.revision || null,

    orderDate,
    expectedDeliveryDate,

    billingAddress:
      payload.billingAddress === undefined
        ? normalizeText(customer.billingAddress)
        : normalizeText(payload.billingAddress),

    shippingAddress:
      payload.shippingAddress === undefined
        ? normalizeText(customer.shippingAddress)
        : normalizeText(payload.shippingAddress),

    currency: "INR",
    taxMode: payload.taxMode,

    paymentTerms:
      normalizeText(payload.paymentTerms) ||
      customer.paymentTerms ||
      "Due on Receipt",

    deliveryTerms: normalizeText(payload.deliveryTerms),
    items,
    ...totals,

    notes: normalizeText(payload.notes),

    termsAndConditions: normalizeText(payload.termsAndConditions),
  };
};

const createAudit = async ({
  models,
  tenantId,
  userId,
  action,
  order,
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
        module: "SALESORDER",
        documentId: order._id,
        oldData,
        newData: order.toObject(),
        ipAddress,
      },
    ],
    { session },
  );
};

const loadOrder = async ({ models, tenantId, orderNumber, session }) => {
  const normalized = normalizeCode(orderNumber);

  if (!normalized) {
    throw createError("Sales order number is required");
  }

  const order = await models.SalesOrder.findOne({
    tenantId,
    orderNumber: normalized,
    isDeleted: false,
  }).session(session);

  if (!order) {
    throw createError("Sales order not found", 404);
  }

  return order;
};

const validateBeforeConfirmation = async ({
  models,
  tenantId,
  order,
  session,
}) => {
  if (order.totalAmountPaise <= 0) {
    throw createError(
      "A sales order must have a positive total to be confirmed",
      409,
    );
  }

  await getCustomer({
    models,
    tenantId,
    customerId: order.customerId,
    session,
  });

  const productIds = [
    ...new Set(order.items.map((item) => String(item.productId))),
  ];

  const products = await models.Product.find({
    _id: { $in: productIds },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError("One or more order products are no longer active", 409);
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  for (const item of order.items) {
    const product = productMap.get(String(item.productId));

    if (product.type !== item.productType || product.unit !== item.unit) {
      throw createError(
        `Product type or unit changed for ${item.productName}. Review the draft before confirming.`,
        409,
      );
    }
  }

  if (order.sourceQuotationId) {
    await getAcceptedQuotation({
      models,
      tenantId,
      quotationId: order.sourceQuotationId,
      customerId: order.customerId,
      session,
    });

    await ensureNoExistingConversion({
      models,
      tenantId,
      quotationId: order.sourceQuotationId,
      excludeOrderId: order._id,
      session,
    });
  }
};

const confirmOrderInTransaction = async (context) => {
  const { order, userId, session } = context;

  if (order.status !== "DRAFT") {
    throw createError("Only draft sales orders can be confirmed", 409);
  }

  await validateBeforeConfirmation(context);

  const oldData = order.toObject();

  order.status = "CONFIRMED";
  order.confirmedAt = new Date();
  order.confirmedBy = userId;
  order.updatedBy = userId;

  await order.save({ session });

  await createAudit({
    ...context,
    action: "CONFIRM",
    oldData,
  });

  return order;
};

const createOrderInTransaction = async (context, payload) => {
  const { models, tenantId, userId, connection, session } = context;

  const action = payload.action ?? "SAVE";

  if (!["SAVE", "CONFIRM"].includes(action)) {
    throw createError("Invalid Sales Order action");
  }

  const orderData = await calculateOrder({
    ...context,
    payload,
  });

  if (orderData.sourceQuotationId) {
    await ensureNoExistingConversion({
      ...context,
      quotationId: orderData.sourceQuotationId,
    });
  }

  const orderNumber = await getNextSequence("SO", tenantId.toString(), 3, {
    connection,
    session,
  });

  const records = await models.SalesOrder.create(
    [
      {
        ...orderData,
        tenantId,
        orderNumber,
        status: "DRAFT",
        createdBy: userId,
        updatedBy: userId,
      },
    ],
    { session },
  );

  const order = records[0];

  await createAudit({
    ...context,
    order,
    action: "CREATE",
  });

  if (action === "CONFIRM") {
    await confirmOrderInTransaction({
      ...context,
      order,
    });
  }

  return order.toObject();
};

const createSalesOrder = async (args) =>
  runTransaction(args, (context) => {
    if (!args.payload || typeof args.payload !== "object") {
      throw createError("Sales Order payload is required");
    }

    return createOrderInTransaction(context, args.payload);
  });

const getOrderByNumber = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const order = await models.SalesOrder.findOne({
    tenantId,
    orderNumber: normalizeCode(args.orderNumber),
    isDeleted: false,
  }).lean();

  if (!order) {
    throw createError("Sales order not found", 404);
  }

  return order;
};

const addDateRange = (filter, field, fromValue, toValue) => {
  if (!fromValue && !toValue) {
    return;
  }

  const from = fromValue ? parseDate(fromValue, `${field} start`) : null;

  const to = toValue ? parseDate(toValue, `${field} end`) : null;

  if (from && to && to < from) {
    throw createError(`${field} end cannot be before its start`);
  }

  filter[field] = {};

  if (from) {
    filter[field].$gte = from;
  }

  if (to) {
    // Include the full final day for date-only filters.
    if (typeof toValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(toValue)) {
      const nextDay = new Date(to);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      filter[field].$lt = nextDay;
    } else {
      filter[field].$lte = to;
    }
  }
};

// const getSalesOrders = async (args) => {
//   const { models, tenantId } = resolveContext(args);

//   const {
//     search,
//     status,
//     customerId,
//     sourceQuotationId,
//     orderDateFrom,
//     orderDateTo,
//     expectedDeliveryFrom,
//     expectedDeliveryTo,
//   } = args;

//   const page = Math.max(Math.floor(Number(args.page) || 1), 1);

//   const limit = Math.min(
//     Math.max(Math.floor(Number(args.limit) || 20), 1),
//     100,
//   );

//   const filter = {
//     tenantId,
//     isDeleted: false,
//   };

//   if (status) {
//     if (!ORDER_STATUSES.includes(status)) {
//       throw createError("Invalid Sales Order status");
//     }

//     filter.status = status;
//   }

//   if (customerId) {
//     filter.customerId = validateObjectId(customerId, "customerId");
//   }

//   if (sourceQuotationId) {
//     filter.sourceQuotationId = validateObjectId(
//       sourceQuotationId,
//       "sourceQuotationId",
//     );
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     const regex = new RegExp(escapeRegex(searchText), "i");

//     filter.$or = [
//       { orderNumber: regex },
//       { customerName: regex },
//       { customerCode: regex },
//     ];
//   }

//   addDateRange(filter, "orderDate", orderDateFrom, orderDateTo);

//   addDateRange(
//     filter,
//     "expectedDeliveryDate",
//     expectedDeliveryFrom,
//     expectedDeliveryTo,
//   );

//   const [data, total] = await Promise.all([
//     models.SalesOrder.find(filter)
//       .sort({
//         orderDate: -1,
//         createdAt: -1,
//         _id: -1,
//       })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean(),

//     models.SalesOrder.countDocuments(filter),
//   ]);

//   return {
//     data,
//     pagination: {
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//     },
//   };
// };
const getSalesOrders = async (args) => {
  const {
    models,
    tenantId,
  } = resolveContext(args);

  const {
    search,
    status,
    customerId,
    sourceQuotationId,
    orderDateFrom,
    orderDateTo,
    expectedDeliveryFrom,
    expectedDeliveryTo,
    page = 1,
    limit = 20,
  } = args;

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) filter.status = status;

  if (customerId) {
    filter.customerId = validateObjectId(customerId, "customerId");
  }

  if (sourceQuotationId) {
    filter.sourceQuotationId = validateObjectId(
      sourceQuotationId,
      "sourceQuotationId",
    );
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");

    filter.$or = [
      { orderNumber: regex },
      { customerName: regex },
      { customerCode: regex },
    ];
  }

  if (orderDateFrom || orderDateTo) {
    filter.orderDate = {};

    if (orderDateFrom) {
      filter.orderDate.$gte = new Date(orderDateFrom);
    }

    if (orderDateTo) {
      filter.orderDate.$lte = new Date(`${orderDateTo}T23:59:59.999Z`);
    }
  }

  if (expectedDeliveryFrom || expectedDeliveryTo) {
    filter.expectedDeliveryDate = {};

    if (expectedDeliveryFrom) {
      filter.expectedDeliveryDate.$gte = new Date(expectedDeliveryFrom);
    }

    if (expectedDeliveryTo) {
      filter.expectedDeliveryDate.$lte = new Date(
        `${expectedDeliveryTo}T23:59:59.999Z`,
      );
    }
  }

  const currentPage = Math.max(Number(page) || 1, 1);
  const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const [orders, total] = await Promise.all([
    models.SalesOrder.find(filter)
      .sort({ orderDate: -1, createdAt: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    models.SalesOrder.countDocuments(filter),
  ]);

  const orderIds = orders.map((order) => order._id);

  const invoices = await models.SalesInvoice.find({
    tenantId,
    sourceSalesOrderId: { $in: orderIds },
    isDeleted: false,
    status: { $ne: "CANCELLED" },
  })
    .select("sourceSalesOrderId invoiceNumber")
    .lean();

  const invoiceMap = new Map(
    invoices.map((invoice) => [
      String(invoice.sourceSalesOrderId),
      invoice.invoiceNumber,
    ]),
  );

  const ordersWithInvoiceNumber = orders.map((order) => ({
    ...order,
    invoiceNumber: invoiceMap.get(String(order._id)) || null,
  }));

  return {
    data: ordersWithInvoiceNumber,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const updateSalesOrder = async (args) =>
  runTransaction(args, async (context) => {
    const { userId, session } = context;
    const payload = args.payload || {};

    const order = await loadOrder(context);

    if (order.status !== "DRAFT") {
      throw createError("Only draft sales orders can be edited", 409);
    }

    assertVersion(order, args.version ?? payload.version);

    if (
      !EDITABLE_FIELDS.some((field) =>
        Object.prototype.hasOwnProperty.call(payload, field),
      )
    ) {
      throw createError("Provide at least one editable field");
    }

    const oldData = order.toObject();

    const merged = {
      customerId: order.customerId,
      sourceQuotationId: order.sourceQuotationId,

      orderDate: order.orderDate,
      expectedDeliveryDate: order.expectedDeliveryDate,

      billingAddress: order.billingAddress,
      shippingAddress: order.shippingAddress,

      taxMode: order.taxMode,
      paymentTerms: order.paymentTerms,
      deliveryTerms: order.deliveryTerms,

      items: order.items.map((item) => ({
        lineId: item.lineId,
        quotationLineId: item.quotationLineId,
        productId: item.productId,
        specification: item.specification,
        quantity: item.quantity,
        unitRatePaise: item.unitRatePaise,
        discountPercent: item.discountPercent,
        gstRate: item.gstRate,
      })),

      notes: order.notes,
      termsAndConditions: order.termsAndConditions,
    };

    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        merged[field] = payload[field];
      }
    }

    const orderData = await calculateOrder({
      ...context,
      payload: merged,
      existingOrder: order,
    });

    // Source references are immutable and remain unchanged.
    const {
      sourceQuotationId,
      sourceQuotationNumber,
      sourceQuotationRevision,
      ...editableData
    } = orderData;

    order.set({
      ...editableData,
      updatedBy: userId,
    });

    await order.save({ session });

    await createAudit({
      ...context,
      order,
      oldData,
      action: "UPDATE",
    });

    return order.toObject();
  });

const confirmSalesOrder = async (args) =>
  runTransaction(args, async (context) => {
    const order = await loadOrder(context);

    assertVersion(order, args.version ?? args.payload?.version);

    await confirmOrderInTransaction({
      ...context,
      order,
    });

    return order.toObject();
  });

const transitionOrder = async (
  args,
  { allowedStatuses, targetStatus, action, dateField, userField },
) =>
  runTransaction(args, async (context) => {
    const { userId, session } = context;
    const order = await loadOrder(context);

    assertVersion(order, args.version ?? args.payload?.version);

    if (!allowedStatuses.includes(order.status)) {
      throw createError(
        `Cannot change a ${order.status} sales order to ${targetStatus}`,
        409,
      );
    }

    const oldData = order.toObject();

    order.status = targetStatus;
    order[dateField] = new Date();
    order[userField] = userId;
    order.updatedBy = userId;

    if (targetStatus === "CANCELLED") {
      order.cancellationReason = normalizeText(
        args.cancellationReason ?? args.payload?.cancellationReason,
      );
    }

    await order.save({ session });

    await createAudit({
      ...context,
      order,
      oldData,
      action,
    });

    return order.toObject();
  });

const startSalesOrder = async (args) =>
  transitionOrder(args, {
    allowedStatuses: ["CONFIRMED"],
    targetStatus: "IN_PROGRESS",
    action: "START",
    dateField: "startedAt",
    userField: "startedBy",
  });

const completeSalesOrder = async (args) =>
  transitionOrder(args, {
    allowedStatuses: ["IN_PROGRESS"],
    targetStatus: "COMPLETED",
    action: "COMPLETE",
    dateField: "completedAt",
    userField: "completedBy",
  });

const cancelSalesOrder = async (args) =>
  transitionOrder(args, {
    allowedStatuses: ["DRAFT", "CONFIRMED", "IN_PROGRESS"],
    targetStatus: "CANCELLED",
    action: "CANCEL",
    dateField: "cancelledAt",
    userField: "cancelledBy",
  });

const deleteSalesOrder = async (args) =>
  runTransaction(args, async (context) => {
    const { userId, session } = context;
    const order = await loadOrder(context);

    assertVersion(order, args.version ?? args.payload?.version);

    if (order.status !== "DRAFT") {
      throw createError("Only draft sales orders can be deleted", 409);
    }

    const oldData = order.toObject();

    order.isDeleted = true;
    order.deletedAt = new Date();
    order.deletedBy = userId;
    order.updatedBy = userId;

    await order.save({ session });

    await createAudit({
      ...context,
      order,
      oldData,
      action: "DELETE",
    });

    return true;
  });

// const convertQuotationToSalesOrder = async (args) =>
//   runTransaction(args, async (context) => {
//     const payload = args.payload || {};

//     const quotation = await getAcceptedQuotation({
//       ...context,
//       quotationId: args.quotationId,
//     });

//     await ensureNoExistingConversion({
//       ...context,
//       quotationId: quotation._id,
//     });

//     const orderPayload = {
//       sourceQuotationId: quotation._id,
//       customerId: quotation.customerId,

//       orderDate:
//         payload.orderDate || localDateString(),

//       expectedDeliveryDate:
//         payload.expectedDeliveryDate ?? null,

//       billingAddress:
//         payload.billingAddress !== undefined
//           ? payload.billingAddress
//           : quotation.billingAddress,

//       shippingAddress:
//         payload.shippingAddress !== undefined
//           ? payload.shippingAddress
//           : quotation.shippingAddress,

//       taxMode:
//         payload.taxMode || quotation.taxMode,

//       paymentTerms:
//         payload.paymentTerms ?? quotation.paymentTerms,

//       deliveryTerms:
//         payload.deliveryTerms ?? null,

//       items:
//         payload.items ??
//         quotation.items.map((item) => ({
//           quotationLineId: item.lineId,
//           productId: item.productId,
//           specification: item.specification,
//           quantity: item.quantity,
//           unitRatePaise: item.unitRatePaise,
//           discountPercent: item.discountPercent,
//           gstRate: item.gstRate,
//         })),

//       notes:
//         payload.notes !== undefined
//           ? payload.notes
//           : quotation.notes,

//       termsAndConditions:
//         payload.termsAndConditions !== undefined
//           ? payload.termsAndConditions
//           : quotation.termsAndConditions,

//       action: payload.action || "SAVE",
//     };

//     return createOrderInTransaction(
//       context,
//       orderPayload,
//     );
//   });
const convertQuotationToSalesOrder = async (args) =>
  runTransaction(args, async (context) => {
    const { models, tenantId, session } = context;

    const payload = args.payload || {};

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError(
        "Quotation version is required. Refresh the comparison.",
      );
    }

    const quotation = await getAcceptedQuotation({
      ...context,
      quotationId: args.quotationId,
    });

    if (quotation.__v !== payload.version) {
      throw createError(
        "This offer changed. Refresh the comparison before selecting it.",
        409,
      );
    }

    if (
      payload.comparisonGroupId &&
      String(quotation.comparisonGroupId) !== String(payload.comparisonGroupId)
    ) {
      throw createError(
        "The selected quotation does not belong to this comparison",
        409,
      );
    }

    const latestRevision = await models.SalesQuotation.findOne({
      tenantId,
      quotationFamilyId: quotation.quotationFamilyId,
      isDeleted: false,
    })
      .sort({ revision: -1, _id: -1 })
      .session(session)
      .select("_id")
      .lean();

    if (
      !latestRevision ||
      String(latestRevision._id) !== String(quotation._id)
    ) {
      throw createError("Select the latest quotation revision", 409);
    }

    await ensureNoExistingConversion({
      ...context,
      quotationId: quotation._id,
    });

    /*
     * Serialize conversion against another conversion
     * or a concurrent edit of this quotation.
     */
    const locked = await models.SalesQuotation.updateOne(
      {
        _id: quotation._id,
        tenantId,
        isDeleted: false,
        status: quotation.status,
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
      throw createError(
        "The selected offer changed. Refresh and try again.",
        409,
      );
    }

    const orderPayload = {
      sourceQuotationId: quotation._id,
      customerId: quotation.customerId,

      orderDate: payload.orderDate || localDateString(),

      expectedDeliveryDate: Object.prototype.hasOwnProperty.call(
        payload,
        "expectedDeliveryDate",
      )
        ? payload.expectedDeliveryDate
        : quotation.expectedDeliveryDate,

      billingAddress: quotation.billingAddress,
      shippingAddress: quotation.shippingAddress,

      taxMode: quotation.taxMode,
      paymentTerms: quotation.paymentTerms,
      deliveryTerms: quotation.deliveryTerms,

      items: quotation.items.map((item) => ({
        quotationLineId: item.lineId,
        productId: item.productId,
        specification: item.specification,
        quantity: item.quantity,
        unitRatePaise: item.unitRatePaise,
        discountPercent: item.discountPercent,
        gstRate: item.gstRate,
      })),

      notes: quotation.notes,
      termsAndConditions: quotation.termsAndConditions,

      action: payload.action || "SAVE",
    };

    return createOrderInTransaction(context, orderPayload);
  });
module.exports = {
  createSalesOrder,
  getSalesOrders,
  getOrderByNumber,
  updateSalesOrder,
  confirmSalesOrder,
  startSalesOrder,
  completeSalesOrder,
  cancelSalesOrder,
  deleteSalesOrder,
  convertQuotationToSalesOrder,
};
