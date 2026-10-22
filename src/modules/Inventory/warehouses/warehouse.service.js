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

const createWarehouse = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload;

    validatePayload(payload, [
      "warehouseCode",
      "name",
      "address",
      "description",
    ]);

    await loadSettings(context);

    const warehouseCode = normalizeCode(payload.warehouseCode);

    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(warehouseCode)) {
      throw createError("Invalid warehouse code");
    }

    if (warehouseCode === "MAIN") {
      throw createError("MAIN is reserved for the default location");
    }

    const fields = buildFields(payload, true);

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
      {
        session: context.session,
      },
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

  const filter = {
    tenantId: context.tenantId,
  };

  if (args.status) {
    if (!["ACTIVE", "INACTIVE"].includes(args.status)) {
      throw createError("Invalid warehouse status");
    }

    filter.status = args.status;
  }

  const search = String(args.search ?? "").trim();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { warehouseCode: regex },
      { name: regex },
      { address: regex },
    ];
  }

  const [records, total] = await Promise.all([
    context.models.Warehouse.find(filter)
      .sort({
        isSystem: -1,
        name: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    context.models.Warehouse.countDocuments(filter),
  ]);

  const data = records.map((warehouse) => ({
    ...warehouse,

    isDefault: String(warehouse._id) === String(settings.defaultWarehouseId),
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
  getWarehouse,
  updateWarehouse,
  getInventorySettings,
};
