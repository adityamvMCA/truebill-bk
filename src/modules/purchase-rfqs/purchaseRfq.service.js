const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const EDITABLE_FIELDS = [
  "rfqDate",
  "quotationDueDate",
  "supplierIds",
  "deliveryAddress",
  "paymentTerms",
  "deliveryTerms",
  "termsAndConditions",
  "notes",
];

const hasOwn = (object, field) =>
  Object.prototype.hasOwnProperty.call(object, field);

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const text = (value) => String(value ?? "").trim() || null;

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

  const result = new Date(value);

  if (Number.isNaN(result.getTime())) {
    throw createError(`${label} is invalid`);
  }

  return result;
};

const normalizeNumber = (value) => {
  const result = text(value)?.toUpperCase();

  if (!result) {
    throw createError("RFQ number is required");
  }

  return result;
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
   TENANT CONTEXT / TRANSACTIONS
   ========================================== */

const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "PurchaseRfq",
    "PurchaseRequisition",
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
    tenantId: objectId(args.tenant._id, "tenantId"),
    connection,
    models,
  };
};

const transaction = async (args, operation) => {
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
    if (error.name === "VersionError") {
      throw createError("RFQ changed. Reload before continuing.", 409);
    }

    if (error.code === 11000) {
      throw createError(
        "An RFQ already reserves this requisition, or the RFQ number already exists",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

/* ==========================================
   LOAD / AUDIT
   ========================================== */

const loadRfq = async (context) => {
  const document = await context.models.PurchaseRfq.findOne({
    tenantId: context.tenantId,
    rfqNumber: normalizeNumber(context.rfqNumber),
    isDeleted: false,
  }).session(context.session ?? null);

  if (!document) {
    throw createError("RFQ not found", 404);
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
        module: "PURCHASERFQ",
        documentId: document._id,
        oldData,
        newData: document.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    {
      session: context.session,
    },
  );
};

/* ==========================================
   SUPPLIERS
   ========================================== */

const validateSuppliers = async (context, inputIds) => {
  if (
    !Array.isArray(inputIds) ||
    inputIds.length < 1 ||
    inputIds.length > 100
  ) {
    throw createError("Provide between 1 and 100 suppliers");
  }

  const ids = inputIds.map((id) => objectId(id, "supplierId"));

  if (new Set(ids.map(String)).size !== ids.length) {
    throw createError("Supplier IDs must be unique");
  }

  const count = await context.models.Supplier.countDocuments({
    tenantId: context.tenantId,
    _id: { $in: ids },
    isDeleted: false,
  }).session(context.session);

  if (count !== ids.length) {
    throw createError(
      "One or more suppliers are missing, deleted, or outside this tenant",
      409,
    );
  }

  return ids;
};

/* ==========================================
   PRODUCTS
   ========================================== */

const getProductMap = async (context, items) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
    throw createError("An RFQ requires between 1 and 200 items");
  }

  const ids = [
    ...new Set(
      items.map((item) => String(objectId(item.productId, "productId"))),
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

  return new Map(products.map((product) => [String(product._id), product]));
};

const validateProductSnapshots = async (context, items) => {
  const productMap = await getProductMap(context, items);

  for (const item of items) {
    const product = productMap.get(String(item.productId));

    if (product.type !== item.productType || product.unit !== item.unit) {
      throw createError(
        `Product type or unit changed for ${item.productName}. Review the RFQ source before issuing.`,
        409,
      );
    }
  }
};

/* ==========================================
   DIRECT RFQ ITEMS
   ========================================== */

const buildDirectItems = async (context, inputItems, existing = null) => {
  const productMap = await getProductMap(context, inputItems);

  const existingLines = new Map(
    (existing?.items || []).map((item) => [String(item.lineId), item]),
  );

  const seenLineIds = new Set();

  return inputItems.map((input) => {
    const productId = objectId(input.productId, "productId");

    const product = productMap.get(String(productId));

    const lineId = input.lineId
      ? objectId(input.lineId, "lineId")
      : new mongoose.Types.ObjectId();

    const key = String(lineId);

    if (seenLineIds.has(key)) {
      throw createError("Each lineId must be unique");
    }

    seenLineIds.add(key);

    const previous = existingLines.get(key);

    if (previous && String(previous.productId) !== String(productId)) {
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
      requisitionLineId: null,

      productId,
      productCode: product.productCode,
      productName: product.name,
      productType: product.type,
      unit: product.unit,

      quantity: Math.round(scaled) / 1000,
      specification: text(input.specification),
    };
  });
};

/* ==========================================
   REQUISITION SOURCE
   ========================================== */

const loadApprovedRequisition = async (
  context,
  sourceRequisitionId,
  sourceVersion,
) => {
  const source = await context.models.PurchaseRequisition.findOne({
    _id: objectId(sourceRequisitionId, "sourceRequisitionId"),
    tenantId: context.tenantId,
    status: "APPROVED",
    isDeleted: false,
  }).session(context.session);

  if (!source) {
    throw createError("Approved purchase requisition not found", 404);
  }

  assertVersion(source, sourceVersion);

  return source;
};

const assertSourceDate = (rfqDate, source) => {
  if (rfqDate < source.requisitionDate) {
    throw createError("RFQ date cannot precede the source requisition date");
  }
};

const ensureSourceAvailable = async (context, sourceId) => {
  const existing = await context.models.PurchaseRfq.findOne({
    tenantId: context.tenantId,
    creationMode: "REQUISITION",
    sourceRequisitionId: sourceId,
    reservesSource: true,
  })
    .session(context.session)
    .select("rfqNumber")
    .lean();

  if (existing) {
    throw createError(
      `This requisition already has RFQ ${existing.rfqNumber}`,
      409,
    );
  }
};

/* ==========================================
   SHARED EDITABLE DATA
   ========================================== */

const buildEditableData = async (context, payload) => {
  const rfqDate = parseDate(payload.rfqDate, "RFQ date");

  const quotationDueDate = parseDate(
    payload.quotationDueDate,
    "Quotation due date",
  );

  if (quotationDueDate < rfqDate) {
    throw createError("Quotation due date cannot precede RFQ date");
  }

  return {
    rfqDate,
    quotationDueDate,

    supplierIds: await validateSuppliers(context, payload.supplierIds),

    deliveryAddress: text(payload.deliveryAddress),
    paymentTerms: text(payload.paymentTerms),
    deliveryTerms: text(payload.deliveryTerms),
    termsAndConditions: text(payload.termsAndConditions),
    notes: text(payload.notes),
  };
};

/* ==========================================
   CREATE — BOTH MODES
   ========================================== */

const createRfq = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    if (!["DIRECT", "REQUISITION"].includes(payload.creationMode)) {
      throw createError("Invalid RFQ creation mode");
    }

    const data = await buildEditableData(context, payload);

    let sourceData;
    let items;

    if (payload.creationMode === "DIRECT") {
      if (
        hasOwn(payload, "sourceRequisitionId") ||
        hasOwn(payload, "sourceRequisitionVersion")
      ) {
        throw createError("DIRECT RFQs cannot contain requisition references");
      }

      items = await buildDirectItems(context, payload.items);

      sourceData = {
        sourceRequisitionId: null,
        sourceRequisitionNumber: null,
        sourceRequisitionVersion: null,
        reservesSource: false,
      };
    } else {
      if (hasOwn(payload, "items")) {
        throw createError(
          "Requisition-based RFQ items must come from the source requisition",
        );
      }

      const source = await loadApprovedRequisition(
        context,
        payload.sourceRequisitionId,
        payload.sourceRequisitionVersion,
      );

      assertSourceDate(data.rfqDate, source);

      await validateProductSnapshots(context, source.items);

      await ensureSourceAvailable(context, source._id);

      items = source.items.map((item) => ({
        lineId: new mongoose.Types.ObjectId(),
        requisitionLineId: item.lineId,

        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        productType: item.productType,
        unit: item.unit,

        quantity: item.quantity,
        specification: item.specification,
      }));

      sourceData = {
        sourceRequisitionId: source._id,
        sourceRequisitionNumber: source.requisitionNumber,
        sourceRequisitionVersion: source.__v,
        reservesSource: true,
      };
    }

    const rfqNumber = await getNextSequence(
      "RFQ",
      String(context.tenantId),
      3,
      {
        connection: context.connection,
        session: context.session,
      },
    );

    const [document] = await context.models.PurchaseRfq.create(
      [
        {
          ...data,
          ...sourceData,

          tenantId: context.tenantId,
          rfqNumber,
          creationMode: payload.creationMode,

          items,
          status: "CREATED",

          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      {
        session: context.session,
      },
    );

    await audit(context, document, "CREATE");

    return document.toObject();
  });

/* ==========================================
   READ
   ========================================== */

const getRfq = async (args) => {
  const context = resolveContext(args);
  const document = await loadRfq(context);

  return document.toObject();
};

// const listRfqs = async (args) => {
//   const { models, tenantId } = resolveContext(args);

//   const {
//     page = 1,
//     limit = 20,
//     search,
//     status,
//     creationMode,
//     supplierId,
//     sourceRequisitionId,
//   } = args;

//   const filter = {
//     tenantId,
//     isDeleted: false,
//   };

//   if (status) filter.status = status;

//   if (creationMode) {
//     filter.creationMode = creationMode;
//   }

//   if (supplierId) {
//     filter.supplierIds = objectId(supplierId, "supplierId");
//   }

//   if (sourceRequisitionId) {
//     filter.sourceRequisitionId = objectId(
//       sourceRequisitionId,
//       "sourceRequisitionId",
//     );
//   }

//   if (search) {
//     const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

//     const regex = new RegExp(escaped, "i");

//     filter.$or = [{ rfqNumber: regex }, { sourceRequisitionNumber: regex }];
//   }

//   const [data, total] = await Promise.all([
//     models.PurchaseRfq.find(filter)
//       .sort({
//         rfqDate: -1,
//         _id: -1,
//       })
//       .skip((page - 1) * limit)
//       .limit(limit)
//       .lean(),

//     models.PurchaseRfq.countDocuments(filter),
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
const listRfqs = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const allowedSortFields = new Set([
    "rfqNumber",
    "rfqDate",
    "quotationDueDate",
    "creationMode",
    "status",
    "sourceRequisitionNumber",
    "paymentTerms",
    "createdAt",
  ]);

  const currentPage = Math.min(
    100000,
    Math.max(1, Number.parseInt(args.page, 10) || 1),
  );

  const pageLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(args.limit, 10) || 20),
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (args.status) {
    filter.status = args.status;
  }

  if (args.creationMode) {
    filter.creationMode = args.creationMode;
  }

  if (args.supplierId) {
    filter.supplierIds = objectId(
      args.supplierId,
      "supplierId",
    );
  }

  if (args.sourceRequisitionId) {
    filter.sourceRequisitionId = objectId(
      args.sourceRequisitionId,
      "sourceRequisitionId",
    );
  }

  const search = String(args.search || "")
    .trim()
    .slice(0, 100);

  if (search) {
    const escaped = search.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    // Preserve contains-style searching from your existing RFQ service.
    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { rfqNumber: regex },
      { sourceRequisitionNumber: regex },
    ];
  }

  const sortField = allowedSortFields.has(args.sortBy)
    ? args.sortBy
    : "rfqDate";

  const sortDirection =
    args.sortOrder === "asc" ? 1 : -1;

  const skip = (currentPage - 1) * pageLimit;

  const [data, total] = await Promise.all([
    models.PurchaseRfq.find(filter)
      .sort({
        [sortField]: sortDirection,
        _id: sortDirection,
      })
      .skip(skip)
      .limit(pageLimit)
      .lean(),

    models.PurchaseRfq.countDocuments(filter),
  ]);

  return {
    data,

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.max(
        1,
        Math.ceil(total / pageLimit),
      ),
    },
  };
};
/* ==========================================
   UPDATE
   ========================================== */

const updateRfq = (args) =>
  transaction(args, async (context) => {
    const document = await loadRfq(context);
    const payload = args.payload || {};

    assertVersion(document, payload.version);

    if (document.status !== "CREATED") {
      throw createError("Only CREATED RFQs can be edited", 409);
    }

    if (document.creationMode === "REQUISITION" && hasOwn(payload, "items")) {
      throw createError(
        "Items cannot be edited on a requisition-based RFQ",
        409,
      );
    }

    const oldData = document.toObject();
    const merged = {};

    for (const field of EDITABLE_FIELDS) {
      merged[field] = hasOwn(payload, field) ? payload[field] : oldData[field];
    }

    const data = await buildEditableData(context, merged);

    if (document.creationMode === "REQUISITION") {
      const source = await loadApprovedRequisition(
        context,
        document.sourceRequisitionId,
        document.sourceRequisitionVersion,
      );

      assertSourceDate(data.rfqDate, source);
    }

    if (document.creationMode === "DIRECT" && hasOwn(payload, "items")) {
      data.items = await buildDirectItems(context, payload.items, document);
    }

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
   STATUS TRANSITIONS
   ========================================== */

const transition = (args, target) =>
  transaction(args, async (context) => {
    const document = await loadRfq(context);
    const payload = args.payload || {};

    assertVersion(document, payload.version);

    const config = {
      ISSUED: {
        allowed: ["CREATED"],
        dateField: "issuedAt",
        userField: "issuedBy",
        action: "ISSUE",
      },

      CLOSED: {
        allowed: ["ISSUED"],
        dateField: "closedAt",
        userField: "closedBy",
        action: "CLOSE",
      },

      CANCELLED: {
        allowed: ["CREATED", "ISSUED"],
        dateField: "cancelledAt",
        userField: "cancelledBy",
        action: "CANCEL",
      },
    }[target];

    if (!config || !config.allowed.includes(document.status)) {
      throw createError(`Cannot change ${document.status} to ${target}`, 409);
    }

    if (target === "ISSUED") {
      await validateSuppliers(context, document.supplierIds);

      await validateProductSnapshots(context, document.items);

      if (document.creationMode === "REQUISITION") {
        const source = await loadApprovedRequisition(
          context,
          document.sourceRequisitionId,
          document.sourceRequisitionVersion,
        );

        assertSourceDate(document.rfqDate, source);
      }
    }

    if (target === "CANCELLED" && !text(payload.cancellationReason)) {
      throw createError("Cancellation reason is required");
    }

    const oldData = document.toObject();

    document.status = target;
    document[config.dateField] = new Date();
    document[config.userField] = context.userId;
    document.updatedBy = context.userId;

    if (target === "CANCELLED") {
      document.cancellationReason = text(payload.cancellationReason);

      document.reservesSource = false;
    }

    await document.save({
      session: context.session,
    });

    await audit(context, document, config.action, oldData);

    return document.toObject();
  });

/* ==========================================
   SOFT DELETE
   ========================================== */

const deleteRfq = (args) =>
  transaction(args, async (context) => {
    const document = await loadRfq(context);

    assertVersion(document, args.payload?.version);

    if (document.status !== "CREATED") {
      throw createError("Only CREATED RFQs can be deleted", 409);
    }

    const oldData = document.toObject();

    document.isDeleted = true;
    document.deletedAt = new Date();
    document.deletedBy = context.userId;
    document.updatedBy = context.userId;
    document.reservesSource = false;

    await document.save({
      session: context.session,
    });

    await audit(context, document, "DELETE", oldData);

    return null;
  });

module.exports = {
  createRfq,
  getRfq,
  listRfqs,
  updateRfq,
  issueRfq: (args) => transition(args, "ISSUED"),
  closeRfq: (args) => transition(args, "CLOSED"),
  cancelRfq: (args) => transition(args, "CANCELLED"),
  deleteRfq,
};
