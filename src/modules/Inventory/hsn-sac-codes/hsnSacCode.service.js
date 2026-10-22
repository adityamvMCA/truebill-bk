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

  for (const name of ["HsnSacCode", "AuditLog"]) {
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
      throw createError("HSN/SAC code already exists", 409);
    }

    if (error.name === "VersionError") {
      throw createError("HSN/SAC code changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const loadCode = async (context) => {
  const code = normalizeCode(context.code);

  if (!/^[A-Z0-9]{2,20}$/.test(code)) {
    throw createError("A valid HSN/SAC code is required");
  }

  const record = await context.models.HsnSacCode.findOne({
    tenantId: context.tenantId,
    code,
  }).session(context.session ?? null);

  if (!record) {
    throw createError("HSN/SAC code not found", 404);
  }

  return record;
};

const audit = async (context, record, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "HSN_SAC_CODE",
        documentId: record._id,
        oldData,
        newData: record.toObject(),
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

  if (creating || hasOwn(payload, "description")) {
    const description = nullableText(payload.description);

    if (description && description.length > 500) {
      throw createError("Description cannot exceed 500 characters");
    }

    fields.description = description;
  }

  if (creating || hasOwn(payload, "defaultGstRate")) {
    const gstRate = payload.defaultGstRate ?? 0;

    if (
      typeof gstRate !== "number" ||
      !Number.isFinite(gstRate) ||
      gstRate < 0 ||
      gstRate > 100
    ) {
      throw createError("Default GST rate must be between 0 and 100");
    }

    fields.defaultGstRate = gstRate;
  }

  if (creating || hasOwn(payload, "status")) {
    const status = payload.status ?? "ACTIVE";

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw createError("Invalid HSN/SAC status");
    }

    fields.status = status;
  }

  return fields;
};

const createHsnSacCode = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    const code = normalizeCode(payload.code);

    if (!/^[A-Z0-9]{2,20}$/.test(code)) {
      throw createError("HSN/SAC code must contain 2–20 letters or numbers");
    }

    const fields = buildFields(payload, true);

    const [record] = await context.models.HsnSacCode.create(
      [
        {
          ...fields,
          tenantId: context.tenantId,
          code,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      {
        session: context.session,
      },
    );

    await audit(context, record, "CREATE");

    return record.toObject();
  });

const getHsnSacCode = async (args) => {
  const context = resolveContext(args);
  const record = await loadCode(context);

  return record.toObject();
};

const listHsnSacCodes = async (args) => {
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
      throw createError("Invalid HSN/SAC status");
    }

    filter.status = args.status;
  }

  const search = String(args.search ?? "").trim();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [{ code: regex }, { description: regex }];
  }

  const [data, total] = await Promise.all([
    models.HsnSacCode.find(filter)
      .sort({
        code: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    models.HsnSacCode.countDocuments(filter),
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

const updateHsnSacCode = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};
    const record = await loadCode(context);

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError("A valid version is required");
    }

    if (record.__v !== payload.version) {
      throw createError("HSN/SAC code changed. Reload before continuing.", 409);
    }

    if (
      !["description", "defaultGstRate", "status"].some((field) =>
        hasOwn(payload, field),
      )
    ) {
      throw createError("Provide at least one editable field");
    }

    if (hasOwn(payload, "code")) {
      throw createError("HSN/SAC code cannot be changed");
    }

    const oldData = record.toObject();

    record.set({
      ...buildFields(payload),
      updatedBy: context.userId,
    });

    await record.save({
      session: context.session,
    });

    await audit(context, record, "UPDATE", oldData);

    return record.toObject();
  });

module.exports = {
  createHsnSacCode,
  getHsnSacCode,
  listHsnSacCodes,
  updateHsnSacCode,
};
