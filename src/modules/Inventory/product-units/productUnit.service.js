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

const nullableText = (value) => String(value ?? "").trim() || null;

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

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

  for (const name of ["ProductUnit", "AuditLog"]) {
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
      throw createError("Unit code or unit name already exists", 409);
    }

    if (error.name === "VersionError") {
      throw createError("Unit changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const loadUnit = async (context) => {
  const unitCode = normalizeCode(context.unitCode);

  if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(unitCode)) {
    throw createError("A valid unit code is required");
  }

  const unit = await context.models.ProductUnit.findOne({
    tenantId: context.tenantId,
    unitCode,
  }).session(context.session ?? null);

  if (!unit) {
    throw createError("Product unit not found", 404);
  }

  return unit;
};

const audit = async (context, unit, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "PRODUCT_UNIT",
        documentId: unit._id,
        oldData,
        newData: unit.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    {
      session: context.session,
    },
  );
};

const buildFields = (payload, creating = false) => {
  const fields = {};

  if (creating || hasOwn(payload, "name")) {
    const name = normalizeName(payload.name);

    if (!name || name.length > 100) {
      throw createError("Unit name must contain 1–100 characters");
    }

    fields.name = name;
    fields.normalizedName = name.toLowerCase();
  }

  for (const [field, maximum] of [
    ["symbol", 20],
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

  if (creating || hasOwn(payload, "status")) {
    const status = payload.status ?? "ACTIVE";

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw createError("Invalid unit status");
    }

    fields.status = status;
  }

  return fields;
};

const createUnit = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    const unitCode = normalizeCode(payload.unitCode);

    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(unitCode)) {
      throw createError(
        "Unit code must start with a letter and contain up to 20 letters, numbers, or underscores",
      );
    }

    const fields = buildFields(payload, true);

    const [unit] = await context.models.ProductUnit.create(
      [
        {
          ...fields,
          tenantId: context.tenantId,
          unitCode,
          isSystem: false,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      {
        session: context.session,
      },
    );

    await audit(context, unit, "CREATE");

    return unit.toObject();
  });

const getUnit = async (args) => {
  const context = resolveContext(args);
  const unit = await loadUnit(context);

  return unit.toObject();
};

const listUnits = async (args) => {
  const { models, tenantId } = resolveContext(args);

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

  const filter = { tenantId };

  if (args.status) {
    if (!["ACTIVE", "INACTIVE"].includes(args.status)) {
      throw createError("Invalid unit status");
    }

    filter.status = args.status;
  }

  const search = String(args.search ?? "").trim();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [{ unitCode: regex }, { name: regex }, { symbol: regex }];
  }

  const [data, total] = await Promise.all([
    models.ProductUnit.find(filter)
      .sort({
        name: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    models.ProductUnit.countDocuments(filter),
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

const updateUnit = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};
    const unit = await loadUnit(context);

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError("A valid unit version is required");
    }

    if (unit.__v !== payload.version) {
      throw createError("Unit changed. Reload before continuing.", 409);
    }

    if (
      !["name", "symbol", "description", "status"].some((field) =>
        hasOwn(payload, field),
      )
    ) {
      throw createError("Provide at least one editable unit field");
    }

    if (hasOwn(payload, "unitCode") || hasOwn(payload, "isSystem")) {
      throw createError("Unit code and system flag cannot be changed");
    }

    const oldData = unit.toObject();

    unit.set({
      ...buildFields(payload),
      updatedBy: context.userId,
    });

    await unit.save({
      session: context.session,
    });

    await audit(context, unit, "UPDATE", oldData);

    return unit.toObject();
  });

module.exports = {
  createUnit,
  getUnit,
  listUnits,
  updateUnit,
};
