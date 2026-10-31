const mongoose = require("mongoose");


const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");


const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");


const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};


const hasOwn = (object, field) =>
  Object.prototype.hasOwnProperty.call(object, field);


const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");


const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();


const nullableText = (value) => String(value ?? "").trim() || null;


const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};


const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of ["Warehouse", "InventorySettings", "AuditLog"]) {
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
      result = await operation({
        ...context,
        session,
      });
    });

    return result;
  } catch (error) {
    if (error.code === 11000) {
      throw createError("Warehouse code or name already exists", 409);
    }

    if (error.name === "VersionError") {
      throw createError("Warehouse changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};


const loadSettings = async (context) => {
  const settings = await context.models.InventorySettings.findOne({
    tenantId: context.tenantId,
  })
    .session(context.session ?? null)
    .lean();

  if (!settings) {
    throw createError(
      "Warehouse setup is missing. Provision this tenant before continuing.",
      409,
    );
  }

  return settings;
};


const loadWarehouse = async (context) => {
  const warehouseCode = normalizeCode(context.warehouseCode);

  if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(warehouseCode)) {
    throw createError("A valid warehouse code is required");
  }

  const warehouse = await context.models.Warehouse.findOne({
    tenantId: context.tenantId,
    warehouseCode,
  }).session(context.session ?? null);

  if (!warehouse) {
    throw createError("Warehouse not found", 404);
  }

  return warehouse;
};


const buildFields = (payload, creating = false) => {
  const fields = {};

  if (creating || hasOwn(payload, "name")) {
    const name = normalizeName(payload.name);

    if (!name || name.length > 100) {
      throw createError("Warehouse name must contain 1–100 characters");
    }

    fields.name = name;
    fields.normalizedName = name.toLowerCase();
  }

  for (const [field, maximum] of [
    ["address", 2000],
    ["description", 1000],
  ]) {
    if (creating || hasOwn(payload, field)) {
      const value = nullableText(payload[field]);

      if (value && value.length > maximum) {
        throw createError(`${field} cannot exceed ${maximum} characters`);
      }

      fields[field] = value;
    }
  }

  return fields;
};


const validatePayload = (payload, allowedFields) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError("Warehouse payload is required");
  }

  const unexpected = Object.keys(payload).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpected.length) {
    throw createError(`Unsupported fields: ${unexpected.join(", ")}`);
  }
};


const audit = async (context, warehouse, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "WAREHOUSE",
        documentId: warehouse._id,
        oldData,
        newData: warehouse.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    {
      session: context.session,
    },
  );
};

const generateWarehouseCode = async (context) => {
  const counters = context.connection.db.collection("counters");

  const counterId = `${String(context.tenantId)}:WAREHOUSE`;

  while (true) {
    await counters.updateOne(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, session: context.session },
    );

    const counter = await counters.findOne(
      { _id: counterId },
      { session: context.session },
    );

    if (!Number.isSafeInteger(counter?.seq) || counter.seq < 1) {
      throw createError("Invalid warehouse sequence", 500);
    }

    const warehouseCode = `WH${String(counter.seq).padStart(3, "0")}`;

    if (warehouseCode.length > 20) {
      throw createError(
        "Warehouse sequence exceeds the supported code length",
        409,
      );
    }

    const exists = await context.models.Warehouse.exists({
      tenantId: context.tenantId,
      warehouseCode,
    }).session(context.session);

    if (!exists) {
      return warehouseCode;
    }
  }
};

const createWarehouse = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload;

    validatePayload(payload, ["name", "address", "description"]);

    await loadSettings(context);

    const fields = buildFields(payload, true);

    const warehouseCode = await generateWarehouseCode(context);

    const [warehouse] = await context.models.Warehouse.create(
      [
        {
          ...fields,
          tenantId: context.tenantId,
          warehouseCode,
          status: "ACTIVE",
          isSystem: false,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      { session: context.session },
    );

    await audit(context, warehouse, "CREATE");

    return warehouse.toObject();
  });

const listWarehouses = async (args) => {
  const context = resolveContext(args);

  const settings = await loadSettings(context);

  const page = Number(args.page ?? 1);
  const limit = Number(args.limit ?? 20);

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw createError("Invalid pagination");
  }

  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw createError("Pagination offset exceeds the supported range");
  }

  const filter = { tenantId: context.tenantId };

  if (args.status) {
    if (!["ACTIVE", "INACTIVE"].includes(args.status)) {
      throw createError("Invalid warehouse status");
    }

    filter.status = args.status;
  }

  const search = normalizeName(args.search).toLowerCase();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    filter.$or = [
      { warehouseCode: { $regex: `^${escaped}` } },
      { normalizedName: { $regex: `^${escaped}` } },
    ];
  }

  const direction = args.sortDir === "desc" ? -1 : 1;

  const SORTS = {
    warehouseCode: (d) => ({ warehouseCode: d, _id: d }),
    name: (d) => ({ normalizedName: d, _id: d }),
    status: (d) => ({ status: d, normalizedName: d, _id: d }),
    createdAt: (d) => ({ createdAt: d, _id: d }),
    updatedAt: (d) => ({ updatedAt: d, _id: d }),
  };

  const sort = SORTS[args.sortBy]
    ? SORTS[args.sortBy](direction)
    : { isSystem: -1, normalizedName: 1, _id: 1 };

  const [records, total] = await Promise.all([
    context.models.Warehouse.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),

    context.models.Warehouse.countDocuments(filter),
  ]);

  const data = records.map((warehouse) => ({
    ...warehouse,
    isDefault:
      String(warehouse._id) === String(settings.defaultWarehouseId),
  }));

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

const getWarehouseCounts = async (args) => {
  const context = resolveContext(args);

  const [result] = await context.models.Warehouse.aggregate([
    { $match: { tenantId: context.tenantId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const status = Object.fromEntries(
    (result ?? []).map((item) => [item._id, item.count]),
  );

  const active = status.ACTIVE ?? 0;
  const inactive = status.INACTIVE ?? 0;

  return { total: active + inactive, active, inactive };
};

const bulkUpdateStatus = (args) =>
  transaction(args, async (context) => {
    const { ids, status } = args.payload || {};

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw createError("Invalid warehouse status");
    }

    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) {
      throw createError("Provide between 1 and 1000 warehouse IDs");
    }

    const objectIds = [...new Set(ids.map((id) => String(id)))].map((id) =>
      objectId(id, "warehouseId"),
    );

    const existing = await context.models.Warehouse.find({
      tenantId: context.tenantId,
      _id: { $in: objectIds },
    })
      .session(context.session)
      .lean();

    const settings = await loadSettings(context);

    const changing = existing.filter(
      (item) =>
        item.status !== status &&
        String(item._id) !== String(settings.defaultWarehouseId),
    );

    if (changing.length) {
      const result = await context.models.Warehouse.updateMany(
        {
          tenantId: context.tenantId,
          _id: { $in: changing.map((item) => item._id) },
          status: { $ne: status },
        },
        {
          $set: { status, updatedBy: context.userId },
          $inc: { __v: 1 },
        },
        { session: context.session },
      );

      if (result.modifiedCount !== changing.length) {
        throw createError("Warehouses changed. Reload before continuing.", 409);
      }

      const now = new Date();

      await context.models.AuditLog.insertMany(
        changing.map((oldData) => ({
          tenantId: context.tenantId,
          userId: context.userId,
          action: "UPDATE",
          module: "WAREHOUSE",
          documentId: oldData._id,
          oldData,
          newData: {
            ...oldData,
            status,
            updatedBy: context.userId,
            updatedAt: now,
            __v: (oldData.__v ?? 0) + 1,
          },
          ipAddress: context.ipAddress,
        })),
        { session: context.session },
      );
    }

    return {
      matchedCount: existing.length,
      modifiedCount: changing.length,
      skippedCount: existing.length - changing.length,
      notFoundCount: objectIds.length - existing.length,
    };
  });

const getWarehouse = async (args) => {
  const context = resolveContext(args);

  const settings = await loadSettings(context);
  const warehouse = await loadWarehouse(context);

  return {
    ...warehouse.toObject(),
    isDefault: String(warehouse._id) === String(settings.defaultWarehouseId),
  };
};

const updateWarehouse = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload;

    validatePayload(payload, ["version", "name", "address", "description"]);

    await loadSettings(context);

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError("A valid warehouse version is required");
    }

    if (
      !["name", "address", "description"].some((field) =>
        hasOwn(payload, field),
      )
    ) {
      throw createError("Provide at least one editable warehouse field");
    }

    const warehouse = await loadWarehouse(context);

    if (warehouse.__v !== payload.version) {
      throw createError("Warehouse changed. Reload before continuing.", 409);
    }

    const oldData = warehouse.toObject();

    warehouse.set({
      ...buildFields(payload),
      updatedBy: context.userId,
    });

    await warehouse.save({
      session: context.session,
    });

    await audit(context, warehouse, "UPDATE", oldData);

    return warehouse.toObject();
  });

const getInventorySettings = async (args) => {
  const context = resolveContext(args);

  const settings = await loadSettings(context);

  const defaultWarehouse = await context.models.Warehouse.findOne({
    _id: settings.defaultWarehouseId,
    tenantId: context.tenantId,
    status: "ACTIVE",
  })
    .select("_id warehouseCode name status")
    .lean();

  if (!defaultWarehouse) {
    throw createError("Default warehouse is missing or inactive", 409);
  }

  return {
    ...settings,
    defaultWarehouse,
  };
};

module.exports = {
  createWarehouse,
  listWarehouses,
  getWarehouseCounts,
  bulkUpdateStatus,
  getWarehouse,
  updateWarehouse,
  getInventorySettings,
};
