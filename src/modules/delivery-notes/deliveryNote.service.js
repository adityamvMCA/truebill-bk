const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const {
  createStockMovement,
} = require("../stock-movements/stockMovement.service");

const STATUSES = ["CREATED", "DISPATCHED", "DELIVERED", "CANCELLED"];

const EDITABLE_FIELDS = [
  "deliveryDate",
  "expectedDeliveryDate",
  "contactPerson",
  "contactPhone",
  "billingAddress",
  "shippingAddress",
  "customerReference",
  "transporterName",
  "vehicleNumber",
  "trackingNumber",
  "transportDocumentNumber",
  "transportDocumentDate",
  "eWayBillNumber",
  "items",
  "notes",
  "termsAndConditions",
];

const TEXT_LIMITS = {
  contactPerson: 150,
  contactPhone: 30,
  billingAddress: 2000,
  shippingAddress: 2000,
  customerReference: 100,
  transporterName: 200,
  vehicleNumber: 30,
  trackingNumber: 100,
  transportDocumentNumber: 100,
  eWayBillNumber: 50,
  notes: 1000,
  termsAndConditions: 5000,
};

/* ==========================================
   HELPERS
   ========================================== */

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const text = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const boundedText = (value, field, maxLength) => {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw createError(`${field} must be a string`);
  }

  const normalized = text(value);

  if (normalized && normalized.length > maxLength) {
    throw createError(`${field} cannot exceed ${maxLength} characters`);
  }

  return normalized;
};

const code = (value) => text(value)?.toUpperCase() || null;

const objectId = (value, field) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${field} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const dateOnly = (value, field, required = false) => {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw createError(`${field} is required`);
    }

    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw createError(`${field} is invalid`);
    }

    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(`${field} must use YYYY-MM-DD`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`${field} is invalid`);
  }

  return date;
};

const quantityMilli = (value, field = "Quantity") => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0.001 ||
    value > 1000000
  ) {
    throw createError(`${field} must be between 0.001 and 1,000,000`);
  }

  const scaled = value * 1000;
  const integer = Math.round(scaled);

  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
    throw createError(`${field} must have at most three decimal places`);
  }

  return integer;
};

const assertVersion = (document, version) => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError("A non-negative document version is required");
  }

  if (document.__v !== version) {
    throw createError(
      "Delivery note changed. Reload it before continuing.",
      409,
    );
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveContext = (args) => {
  if (!args?.tenant?._id) {
    throw createError(
      "Resolved tenant context is required for Delivery Notes",
      500,
    );
  }

  const connection = getReadyTenantConnection(args.tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of [
    "DeliveryNote",
    "SalesOrder",
    "Customer",
    "Product",
    "StockMovement",
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
    connection,
    models,
    tenantId: objectId(args.tenant._id, "tenantId"),
  };
};

const runTransaction = async (args, operation) => {
  const context = resolveContext(args);

  context.userId = objectId(args.userId, "userId");

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
    if (error?.code === 11000) {
      throw createError(
        "A delivery note number or stock movement reference already exists",
        409,
      );
    }

    if (error?.name === "VersionError") {
      throw createError("Document changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/* ==========================================
   LOOKUPS
   ========================================== */

const getCustomer = async (context, customerId) => {
  const customer = await context.models.Customer.findOne({
    _id: objectId(customerId, "customerId"),
    tenantId: context.tenantId,
    isDeleted: false,
    status: "Active",
  })
    .session(context.session)
    .lean();

  if (!customer) {
    throw createError("Active customer not found in the current tenant", 404);
  }

  return customer;
};

const getSourceOrder = async (context, { sourceSalesOrderId, orderNumber }) => {
  const filter = {
    tenantId: context.tenantId,
    isDeleted: false,
    status: {
      $in: ["CONFIRMED", "IN_PROGRESS"],
    },
  };

  if (sourceSalesOrderId) {
    filter._id = objectId(sourceSalesOrderId, "sourceSalesOrderId");
  } else {
    const normalized = code(orderNumber);

    if (!normalized) {
      throw createError("Sales Order number is required");
    }

    filter.orderNumber = normalized;
  }

  const order = await context.models.SalesOrder.findOne(filter)
    .session(context.session)
    .lean();

  if (!order) {
    throw createError(
      "A confirmed or in-progress Sales Order was not found",
      409,
    );
  }

  return order;
};

const loadNote = async (context) => {
  const number = code(context.deliveryNoteNumber);

  if (!number) {
    throw createError("Delivery Note number is required");
  }

  const note = await context.models.DeliveryNote.findOne({
    tenantId: context.tenantId,
    deliveryNoteNumber: number,
    isDeleted: false,
  }).session(context.session);

  if (!note) {
    throw createError("Delivery Note not found", 404);
  }

  return note;
};

const audit = async (context, note, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        module: "DELIVERY_NOTE",
        action,
        documentId: note._id,
        oldData,
        newData: note.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    {
      session: context.session,
    },
  );
};

/* ==========================================
   BUILD CUSTOMER / PRODUCT SNAPSHOTS
   ========================================== */

const calculateNote = async (context, payload, existing = null) => {
  const customer = await getCustomer(context, payload.customerId);

  let order = null;

  if (payload.sourceSalesOrderId) {
    order = await getSourceOrder(context, {
      sourceSalesOrderId: payload.sourceSalesOrderId,
    });

    if (String(order.customerId) !== String(customer._id)) {
      throw createError(
        "Delivery Note customer must match the Sales Order customer",
        409,
      );
    }
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("A Delivery Note requires between 1 and 200 items");
  }

  const productIds = payload.items.map((item) =>
    objectId(item.productId, "productId").toString(),
  );

  if (new Set(productIds).size !== productIds.length) {
    throw createError("A product can appear only once in a Delivery Note");
  }

  const products = await context.models.Product.find({
    _id: { $in: productIds },
    tenantId: context.tenantId,
    isDeleted: false,
    status: "ACTIVE",
    type: "GOODS",
  })
    .session(context.session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more products are missing, inactive, or are not Goods",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const orderLineMap = new Map(
    (order?.items || []).map((item) => [String(item.lineId), item]),
  );

  const existingLineMap = new Map(
    (existing?.items || []).map((item) => [String(item.lineId), item]),
  );

  const usedLineIds = new Set();
  const usedOrderLineIds = new Set();

  const items = payload.items.map((input, index) => {
    const label = `Item ${index + 1}`;

    const productId = objectId(input.productId, `${label} productId`);

    const product = productMap.get(String(productId));

    const lineId = input.lineId
      ? objectId(input.lineId, `${label} lineId`)
      : new mongoose.Types.ObjectId();

    const lineKey = String(lineId);

    if (usedLineIds.has(lineKey)) {
      throw createError("Delivery Note line IDs must be unique");
    }

    usedLineIds.add(lineKey);

    const previous = existingLineMap.get(lineKey);

    if (previous && String(previous.productId) !== String(productId)) {
      throw createError(
        `${label} cannot reuse a lineId for a different product`,
        409,
      );
    }

    let orderLine = null;
    let salesOrderLineId = null;

    if (order) {
      salesOrderLineId = objectId(
        input.salesOrderLineId,
        `${label} salesOrderLineId`,
      );

      const key = String(salesOrderLineId);

      if (usedOrderLineIds.has(key)) {
        throw createError("A Sales Order line can appear only once");
      }

      usedOrderLineIds.add(key);

      orderLine = orderLineMap.get(key);

      if (
        !orderLine ||
        String(orderLine.productId) !== String(productId) ||
        orderLine.productType !== "GOODS"
      ) {
        throw createError(
          `${label} does not match a Goods line in the Sales Order`,
          409,
        );
      }
    } else if (input.salesOrderLineId) {
      throw createError("Standalone items cannot reference Sales Order lines");
    }

    const milli = quantityMilli(input.quantity, `${label} quantity`);

    if (orderLine && milli > quantityMilli(orderLine.quantity)) {
      throw createError(`${label} quantity exceeds the ordered quantity`, 409);
    }

    const snapshot = previous ||
      orderLine || {
        productCode: product.productCode,
        productName: product.name,
        productType: product.type,
        unit: product.unit,
        hsnSacCode: product.hsnSacCode,
      };

    if (
      snapshot.productType !== product.type ||
      snapshot.unit !== product.unit
    ) {
      throw createError(
        `Product type or unit changed for ${product.name}`,
        409,
      );
    }

    return {
      lineId,
      salesOrderLineId,
      productId,

      productCode: snapshot.productCode,
      productName: snapshot.productName,
      productType: "GOODS",
      unit: snapshot.unit,
      hsnSacCode: snapshot.hsnSacCode || null,

      specification: boundedText(
        input.specification,
        "Item specification",
        1000,
      ),

      quantity: milli / 1000,

      trackInventory: Boolean(product.trackInventory),

      stockMovementId: null,

      notes: boundedText(input.notes, "Item notes", 500),
    };
  });

  const deliveryDate = dateOnly(payload.deliveryDate, "deliveryDate", true);

  const expectedDeliveryDate = dateOnly(
    payload.expectedDeliveryDate,
    "expectedDeliveryDate",
  );

  if (expectedDeliveryDate && expectedDeliveryDate < deliveryDate) {
    throw createError(
      "Expected delivery date cannot be before Delivery Note date",
    );
  }

  const fields = {};

  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    fields[field] = boundedText(payload[field], field, limit);
  }

  fields.billingAddress =
    fields.billingAddress ||
    text(order?.billingAddress) ||
    text(customer.billingAddress);

  fields.shippingAddress =
    fields.shippingAddress ||
    text(order?.shippingAddress) ||
    text(customer.shippingAddress);

  fields.contactPerson = fields.contactPerson || text(customer.contactPerson);

  fields.contactPhone = fields.contactPhone || text(customer.phone);

  if (!fields.shippingAddress) {
    throw createError("A shipping address is required");
  }

  fields.vehicleNumber = code(fields.vehicleNumber);

  return {
    customerId: customer._id,

    customerCode:
      existing?.customerCode ?? order?.customerCode ?? customer.customerCode,

    customerName:
      existing?.customerName ?? order?.customerName ?? customer.customerName,

    customerGstNo: existing
      ? existing.customerGstNo
      : order
        ? order.customerGstNo || null
        : customer.gstNo || null,

    sourceSalesOrderId: order?._id || null,
    sourceSalesOrderNumber: order?.orderNumber || null,

    deliveryDate,
    expectedDeliveryDate,

    transportDocumentDate: dateOnly(
      payload.transportDocumentDate,
      "transportDocumentDate",
    ),

    ...fields,
    items,
  };
};

/* ==========================================
   CREATE
   ========================================== */

const createInTransaction = async (context, payload) => {
  const data = await calculateNote(context, payload);

  const deliveryNoteNumber = await getNextSequence(
    "DN",
    context.tenantId.toString(),
    3,
    {
      connection: context.connection,
      session: context.session,
    },
  );

  const records = await context.models.DeliveryNote.create(
    [
      {
        ...data,
        tenantId: context.tenantId,
        deliveryNoteNumber,
        status: "CREATED",
        createdBy: context.userId,
        updatedBy: context.userId,
      },
    ],
    {
      session: context.session,
    },
  );

  const note = records[0];

  await audit(context, note, "CREATE");

  return note.toObject();
};

const createDeliveryNote = async (args) =>
  runTransaction(args, async (context) => {
    if (!args.payload || typeof args.payload !== "object") {
      throw createError("Delivery Note payload is required");
    }

    return createInTransaction(context, args.payload);
  });

const createDeliveryNoteFromOrder = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};

    const order = await getSourceOrder(context, {
      orderNumber: args.orderNumber,
    });

    if (
      !Array.isArray(payload.items) ||
      !payload.items.length ||
      payload.items.length > 200
    ) {
      throw createError("Select between 1 and 200 Sales Order lines");
    }

    const orderLines = new Map(
      order.items.map((item) => [String(item.lineId), item]),
    );

    const items = payload.items.map((input) => {
      const lineId = objectId(input.salesOrderLineId, "salesOrderLineId");

      const source = orderLines.get(String(lineId));

      if (!source || source.productType !== "GOODS") {
        throw createError("Selected Sales Order Goods line was not found", 409);
      }

      return {
        salesOrderLineId: source.lineId,
        productId: source.productId,
        quantity: input.quantity,
        specification: source.specification || null,
        notes: input.notes,
      };
    });

    return createInTransaction(context, {
      ...payload,
      customerId: order.customerId,
      sourceSalesOrderId: order._id,
      items,
    });
  });

/* ==========================================
   READ
   ========================================== */

const getDeliveryNoteByNumber = async (args) => {
  const context = resolveContext(args);
  const number = code(args.deliveryNoteNumber);

  if (!number) {
    throw createError("Delivery Note number is required");
  }

  const note = await context.models.DeliveryNote.findOne({
    tenantId: context.tenantId,
    deliveryNoteNumber: number,
    isDeleted: false,
  }).lean();

  if (!note) {
    throw createError("Delivery Note not found", 404);
  }

  return note;
};

const getDeliveryNotes = async (args) => {
  const context = resolveContext(args);

  const page = Math.max(Math.floor(Number(args.page) || 1), 1);

  const limit = Math.min(
    Math.max(Math.floor(Number(args.limit) || 20), 1),
    100,
  );

  const filter = {
    tenantId: context.tenantId,
    isDeleted: false,
  };

  if (args.status) {
    if (!STATUSES.includes(args.status)) {
      throw createError("Invalid Delivery Note status");
    }

    filter.status = args.status;
  }

  if (args.customerId) {
    filter.customerId = objectId(args.customerId, "customerId");
  }

  if (args.sourceSalesOrderId) {
    filter.sourceSalesOrderId = objectId(
      args.sourceSalesOrderId,
      "sourceSalesOrderId",
    );
  }

  const search = text(args.search);

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");

    filter.$or = [
      { deliveryNoteNumber: regex },
      { customerCode: regex },
      { customerName: regex },
      { sourceSalesOrderNumber: regex },
      { vehicleNumber: regex },
      { trackingNumber: regex },
    ];
  }

  const from = dateOnly(args.fromDate, "fromDate");
  const to = dateOnly(args.toDate, "toDate");

  if (from && to && to < from) {
    throw createError("End date cannot be before start date");
  }

  if (from || to) {
    filter.deliveryDate = {};

    if (from) {
      filter.deliveryDate.$gte = from;
    }

    if (to) {
      const exclusiveEnd = new Date(to);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      filter.deliveryDate.$lt = exclusiveEnd;
    }
  }

  const [data, total] = await Promise.all([
    context.models.DeliveryNote.find(filter)
      .select("-items")
      .sort({
        deliveryDate: -1,
        createdAt: -1,
        _id: -1,
      })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    context.models.DeliveryNote.countDocuments(filter),
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
   UPDATE CREATED NOTE
   ========================================== */

const updateDeliveryNote = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};
    const note = await loadNote(context);

    assertVersion(note, payload.version);

    if (note.status !== "CREATED") {
      throw createError("Only created Delivery Notes can be edited", 409);
    }

    if (
      !EDITABLE_FIELDS.some((field) =>
        Object.prototype.hasOwnProperty.call(payload, field),
      )
    ) {
      throw createError("Provide at least one editable field");
    }

    const oldData = note.toObject();

    const merged = {
      customerId: note.customerId,
      sourceSalesOrderId: note.sourceSalesOrderId,
    };

    for (const field of EDITABLE_FIELDS) {
      merged[field] = Object.prototype.hasOwnProperty.call(payload, field)
        ? payload[field]
        : oldData[field];
    }

    const data = await calculateNote(context, merged, note);

    // Preserve immutable source links.
    delete data.sourceSalesOrderId;
    delete data.sourceSalesOrderNumber;

    note.set({
      ...data,
      updatedBy: context.userId,
    });

    await note.save({ session: context.session });

    await audit(context, note, "UPDATE", oldData);

    return note.toObject();
  });

/* ==========================================
   ORDER DISPATCH ALLOCATION

   A parent-order write serializes dispatches
   against the same order inside transactions.
   ========================================== */

const validateOrderDispatch = async (context, note) => {
  if (!note.sourceSalesOrderId) {
    return;
  }

  const order = await context.models.SalesOrder.findOneAndUpdate(
    {
      _id: note.sourceSalesOrderId,
      tenantId: context.tenantId,
      customerId: note.customerId,
      isDeleted: false,
      status: {
        $in: ["CONFIRMED", "IN_PROGRESS"],
      },
    },
    {
      $inc: { __v: 1 },
    },
    {
      new: true,
      session: context.session,
    },
  ).lean();

  if (!order) {
    throw createError(
      "The source Sales Order is no longer available for dispatch",
      409,
    );
  }

  const dispatchedNotes = await context.models.DeliveryNote.find({
    tenantId: context.tenantId,
    sourceSalesOrderId: order._id,
    _id: { $ne: note._id },
    isDeleted: false,
    status: {
      $in: ["DISPATCHED", "DELIVERED"],
    },
  })
    .select("items")
    .session(context.session)
    .lean();

  const dispatchedMilli = new Map();

  for (const document of dispatchedNotes) {
    for (const item of document.items) {
      const key = String(item.salesOrderLineId);

      const total =
        (dispatchedMilli.get(key) || 0) + quantityMilli(item.quantity);

      if (!Number.isSafeInteger(total)) {
        throw createError(
          "Dispatched quantity exceeds the supported range",
          409,
        );
      }

      dispatchedMilli.set(key, total);
    }
  }

  const orderLines = new Map(
    order.items.map((item) => [String(item.lineId), item]),
  );

  for (const item of note.items) {
    const key = String(item.salesOrderLineId);
    const source = orderLines.get(key);

    if (
      !source ||
      source.productType !== "GOODS" ||
      String(source.productId) !== String(item.productId) ||
      source.unit !== item.unit
    ) {
      throw createError(
        `Source order line is invalid for ${item.productName}`,
        409,
      );
    }

    const ordered = quantityMilli(source.quantity);
    const alreadyDispatched = dispatchedMilli.get(key) || 0;
    const requested = quantityMilli(item.quantity);

    if (alreadyDispatched + requested > ordered) {
      const remaining = Math.max(ordered - alreadyDispatched, 0);

      throw createError(
        `${item.productName}: remaining dispatch quantity is ${
          remaining / 1000
        } ${item.unit}`,
        409,
      );
    }
  }
};

/* ==========================================
   DISPATCH
   ========================================== */

const dispatchDeliveryNote = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};
    const note = await loadNote(context);

    assertVersion(note, payload.version);

    if (note.status !== "CREATED") {
      throw createError("Only created Delivery Notes can be dispatched", 409);
    }

    await getCustomer(context, note.customerId);

    await validateOrderDispatch(context, note);

    const productIds = note.items.map((item) => item.productId);

    const products = await context.models.Product.find({
      _id: { $in: productIds },
      tenantId: context.tenantId,
      status: "ACTIVE",
      isDeleted: false,
      type: "GOODS",
    })
      .session(context.session)
      .lean();

    if (products.length !== productIds.length) {
      throw createError("One or more products are no longer active Goods", 409);
    }

    const productMap = new Map(
      products.map((product) => [String(product._id), product]),
    );

    const oldData = note.toObject();
    const dispatchedAt = new Date();

    for (const item of note.items) {
      const product = productMap.get(String(item.productId));

      if (
        product.unit !== item.unit ||
        Boolean(product.trackInventory) !== item.trackInventory
      ) {
        throw createError(
          `Inventory settings changed for ${item.productName}. Review the created note before dispatch.`,
          409,
        );
      }

      if (!item.trackInventory) {
        continue;
      }

      // Explicit version-one valuation:
      // Product purchasePrice, not customer selling price.
      const unitRate = Number(product.purchasePrice);

      if (
        !Number.isFinite(unitRate) ||
        unitRate < 0 ||
        !Number.isSafeInteger(Math.round(unitRate * 100)) ||
        Math.abs(unitRate * 100 - Math.round(unitRate * 100)) > 0.000001
      ) {
        throw createError(
          `A valid purchase price is required for ${item.productName}`,
          409,
        );
      }

      const result = await createStockMovement({
        tenant: context.tenant,
        connection: context.connection,
        userId: context.userId,

        productId: item.productId,
        movementType: "DELIVERY",
        quantity: item.quantity,
        unitRate,

        referenceType: "DELIVERY_NOTE",
        referenceId: note._id,
        referenceNumber: note.deliveryNoteNumber,

        movementDate: dispatchedAt,

        notes: `Delivery Note ${note.deliveryNoteNumber}`,
        session: context.session,
      });

      item.stockMovementId = result.movement._id;
    }

    note.status = "DISPATCHED";
    note.dispatchedAt = dispatchedAt;
    note.dispatchedBy = context.userId;

    note.dispatchRemarks = boundedText(
      payload.dispatchRemarks,
      "dispatchRemarks",
      1000,
    );

    note.updatedBy = context.userId;

    await note.save({ session: context.session });

    await audit(context, note, "DISPATCH", oldData);

    return note.toObject();
  });

/* ==========================================
   DELIVERY ACKNOWLEDGMENT
   ========================================== */

const deliverDeliveryNote = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};
    const note = await loadNote(context);

    assertVersion(note, payload.version);

    if (note.status !== "DISPATCHED") {
      throw createError(
        "Only dispatched Delivery Notes can be marked as delivered",
        409,
      );
    }

    const receivedByName = boundedText(
      payload.receivedByName,
      "receivedByName",
      150,
    );

    if (!receivedByName) {
      throw createError("Recipient name is required");
    }

    const oldData = note.toObject();

    note.status = "DELIVERED";
    note.deliveredAt = new Date();
    note.deliveredBy = context.userId;
    note.receivedByName = receivedByName;

    note.receivedByPhone = boundedText(
      payload.receivedByPhone,
      "receivedByPhone",
      30,
    );

    note.deliveryRemarks = boundedText(
      payload.deliveryRemarks,
      "deliveryRemarks",
      1000,
    );

    note.updatedBy = context.userId;

    await note.save({ session: context.session });

    await audit(context, note, "DELIVER", oldData);

    return note.toObject();
  });

/* ==========================================
   CANCEL / SOFT DELETE
   ========================================== */

const cancelDeliveryNote = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};
    const note = await loadNote(context);

    assertVersion(note, payload.version);

    if (note.status !== "CREATED") {
      throw createError(
        "Only created Delivery Notes can be cancelled. Dispatched notes require a return/reversal workflow.",
        409,
      );
    }

    const reason = boundedText(
      payload.cancellationReason,
      "cancellationReason",
      1000,
    );

    if (!reason) {
      throw createError("Cancellation reason is required");
    }

    const oldData = note.toObject();

    note.status = "CANCELLED";
    note.cancelledAt = new Date();
    note.cancelledBy = context.userId;
    note.cancellationReason = reason;
    note.updatedBy = context.userId;

    await note.save({ session: context.session });

    await audit(context, note, "CANCEL", oldData);

    return note.toObject();
  });

const deleteDeliveryNote = async (args) =>
  runTransaction(args, async (context) => {
    const payload = args.payload || {};
    const note = await loadNote(context);

    assertVersion(note, payload.version);

    if (note.status !== "CREATED") {
      throw createError("Only created Delivery Notes can be deleted", 409);
    }

    const oldData = note.toObject();

    note.isDeleted = true;
    note.deletedAt = new Date();
    note.deletedBy = context.userId;
    note.updatedBy = context.userId;

    await note.save({ session: context.session });

    await audit(context, note, "DELETE", oldData);

    return true;
  });

module.exports = {
  createDeliveryNote,
  createDeliveryNoteFromOrder,
  getDeliveryNotes,
  getDeliveryNoteByNumber,
  updateDeliveryNote,
  dispatchDeliveryNote,
  deliverDeliveryNote,
  cancelDeliveryNote,
  deleteDeliveryNote,
};
