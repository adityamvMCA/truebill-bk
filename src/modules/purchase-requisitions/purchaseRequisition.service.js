const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const EDITABLE_FIELDS = [
  "requisitionDate",
  "requiredByDate",
  "department",
  "purpose",
  "priority",
  "items",
  "notes",
];

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

const text = (value) => String(value ?? "").trim() || null;

const normalizeNumber = (value) => {
  const result = text(value)?.toUpperCase();

  if (!result) {
    throw createError("Requisition number is required");
  }

  return result;
};

const parseDate = (value, label) => {
  if (!value) throw createError(`${label} is required`);

  const result = new Date(value);

  if (Number.isNaN(result.getTime())) {
    throw createError(`${label} is invalid`);
  }

  return result;
};

const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["PurchaseRequisition", "Product", "AuditLog"]) {
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
      throw createError("Requisition changed. Reload before continuing.", 409);
    }

    if (error.code === 11000) {
      throw createError(
        "A duplicate requisition number or unique reference exists",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const assertVersion = (document, version) => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw createError("A valid document version is required");
  }

  if (document.__v !== version) {
    throw createError("Requisition changed. Reload before continuing.", 409);
  }
};

const load = async (context) => {
  const document = await context.models.PurchaseRequisition.findOne({
    tenantId: context.tenantId,
    requisitionNumber: normalizeNumber(context.requisitionNumber),
    isDeleted: false,
  }).session(context.session ?? null);

  if (!document) {
    throw createError("Purchase requisition not found", 404);
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
        module: "PURCHASEREQUISITION",
        documentId: document._id,
        oldData,
        newData: document.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session },
  );
};

const buildData = async (context, payload, existing = null) => {
  const requisitionDate = parseDate(
    payload.requisitionDate,
    "Requisition date",
  );

  const requiredByDate = payload.requiredByDate
    ? parseDate(payload.requiredByDate, "Required-by date")
    : null;

  if (requiredByDate && requiredByDate < requisitionDate) {
    throw createError("Required-by date cannot precede requisition date");
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("Provide between 1 and 200 items");
  }

  const productIds = [
    ...new Set(
      payload.items.map((item) =>
        String(objectId(item.productId, "productId")),
      ),
    ),
  ];

  const products = await context.models.Product.find({
    _id: { $in: productIds },
    tenantId: context.tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(context.session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more products are missing, inactive, or outside this tenant",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const existingLines = new Map(
    (existing?.items || []).map((item) => [String(item.lineId), item]),
  );

  const seenLineIds = new Set();

  const items = payload.items.map((input) => {
    const product = productMap.get(
      String(objectId(input.productId, "productId")),
    );

    const lineId = input.lineId
      ? objectId(input.lineId, "lineId")
      : new mongoose.Types.ObjectId();

    const key = String(lineId);

    if (seenLineIds.has(key)) {
      throw createError("Each lineId must be unique");
    }

    seenLineIds.add(key);

    const previous = existingLines.get(key);

    if (previous && String(previous.productId) !== String(product._id)) {
      throw createError(
        "An existing lineId cannot be reused for another product",
        409,
      );
    }

    const scaled = input.quantity * 1000;

    if (
      typeof input.quantity !== "number" ||
      !Number.isFinite(input.quantity) ||
      input.quantity < 0.001 ||
      input.quantity > 1000000 ||
      !Number.isSafeInteger(Math.round(scaled)) ||
      Math.abs(scaled - Math.round(scaled)) > 0.000001
    ) {
      throw createError(
        "Quantity must be 0.001–1000000 with at most three decimals",
      );
    }

    return {
      lineId,
      productId: product._id,
      productCode: product.productCode,
      productName: product.name,
      productType: product.type,
      unit: product.unit,
      quantity: Math.round(scaled) / 1000,
      specification: text(input.specification),
    };
  });

  return {
    requisitionDate,
    requiredByDate,
    department: text(payload.department),
    purpose: text(payload.purpose),
    priority: payload.priority ?? "NORMAL",
    notes: text(payload.notes),
    items,
  };
};

const createRequisition = (args) =>
  transaction(args, async (context) => {
    const data = await buildData(context, args.payload);

    const requisitionNumber = await getNextSequence(
      "PR",
      String(context.tenantId),
      3,
      {
        connection: context.connection,
        session: context.session,
      },
    );

    const [document] = await context.models.PurchaseRequisition.create(
      [
        {
          ...data,
          tenantId: context.tenantId,
          requisitionNumber,
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

const getRequisition = async (args) => {
  const context = resolveContext(args);
  return (await load(context)).toObject();
};

const listRequisitions = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const { page = 1, limit = 20, status, priority, search, createdBy } = args;

  const filter = { tenantId, isDeleted: false };

  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  if (createdBy) {
    filter.createdBy = objectId(createdBy, "createdBy");
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { requisitionNumber: regex },
      { department: regex },
      { purpose: regex },
    ];
  }

  const [data, total] = await Promise.all([
    models.PurchaseRequisition.find(filter)
      .sort({ requisitionDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    models.PurchaseRequisition.countDocuments(filter),
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

const updateRequisition = (args) =>
  transaction(args, async (context) => {
    const document = await load(context);
    assertVersion(document, args.payload.version);

    if (document.status !== "CREATED") {
      throw createError("Only CREATED requisitions can be edited", 409);
    }

    const oldData = document.toObject();
    const merged = {};

    for (const field of EDITABLE_FIELDS) {
      merged[field] = Object.prototype.hasOwnProperty.call(args.payload, field)
        ? args.payload[field]
        : oldData[field];
    }

    const data = await buildData(context, merged, document);

    document.set({
      ...data,
      updatedBy: context.userId,
    });

    await document.save({ session: context.session });
    await audit(context, document, "UPDATE", oldData);

    return document.toObject();
  });

const transition = (args, target) =>
  transaction(args, async (context) => {
    const document = await load(context);
    assertVersion(document, args.payload.version);

    if (document.status !== "CREATED") {
      throw createError(`Cannot change ${document.status} to ${target}`, 409);
    }

    if (target === "APPROVED") {
      const ids = [
        ...new Set(document.items.map((item) => String(item.productId))),
      ];

      const products = await context.models.Product.find({
        tenantId: context.tenantId,
        _id: { $in: ids },
        status: "ACTIVE",
        isDeleted: false,
      })
        .session(context.session)
        .lean();

      const map = new Map(
        products.map((product) => [String(product._id), product]),
      );

      for (const item of document.items) {
        const product = map.get(String(item.productId));

        if (
          !product ||
          product.type !== item.productType ||
          product.unit !== item.unit
        ) {
          throw createError(
            "Products changed or became inactive. Review the requisition before approval.",
            409,
          );
        }
      }
    }

    const config = {
      APPROVED: {
        prefix: "approved",
        action: "APPROVE",
      },
      REJECTED: {
        prefix: "rejected",
        action: "REJECT",
        reasonField: "rejectionReason",
      },
      CANCELLED: {
        prefix: "cancelled",
        action: "CANCEL",
        reasonField: "cancellationReason",
      },
    }[target];

    if (config.reasonField && !text(args.payload[config.reasonField])) {
      throw createError(`${config.reasonField} is required`);
    }

    const oldData = document.toObject();

    document.status = target;
    document[`${config.prefix}At`] = new Date();
    document[`${config.prefix}By`] = context.userId;
    document.updatedBy = context.userId;

    if (config.reasonField) {
      document[config.reasonField] = text(args.payload[config.reasonField]);
    }

    await document.save({ session: context.session });

    await audit(context, document, config.action, oldData);

    return document.toObject();
  });

const deleteRequisition = (args) =>
  transaction(args, async (context) => {
    const document = await load(context);
    assertVersion(document, args.payload.version);

    if (document.status !== "CREATED") {
      throw createError("Only CREATED requisitions can be deleted", 409);
    }

    const oldData = document.toObject();

    document.isDeleted = true;
    document.deletedAt = new Date();
    document.deletedBy = context.userId;
    document.updatedBy = context.userId;

    await document.save({ session: context.session });
    await audit(context, document, "DELETE", oldData);

    return null;
  });

module.exports = {
  createRequisition,
  getRequisition,
  listRequisitions,
  updateRequisition,
  approveRequisition: (args) => transition(args, "APPROVED"),
  rejectRequisition: (args) => transition(args, "REJECTED"),
  cancelRequisition: (args) => transition(args, "CANCELLED"),
  deleteRequisition,
};
