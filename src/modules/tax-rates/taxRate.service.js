const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

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

  for (const name of ["TaxRate", "AuditLog"]) {
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
      throw createError(
        "Tax rate name or rate already exists for this tax type",
        409,
      );
    }

    if (error.name === "VersionError") {
      throw createError("Tax rate changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const loadTaxRate = async (context) => {
  const taxRate = await context.models.TaxRate.findOne({
    tenantId: context.tenantId,
    _id: context.taxRateId,
  }).session(context.session ?? null);

  if (!taxRate) {
    throw createError("Tax rate not found", 404);
  }

  return taxRate;
};

const audit = async (context, taxRate, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "TAX_RATE",
        documentId: taxRate._id,
        oldData,
        newData: taxRate.toObject(),
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
      throw createError("Tax rate name must contain 1–100 characters");
    }

    fields.name = name;
    fields.normalizedName = name.toLowerCase();
  }

  if (creating || hasOwn(payload, "description")) {
    const description = nullableText(payload.description);

    if (description && description.length > 1000) {
      throw createError("Description cannot exceed 1000 characters");
    }

    fields.description = description;
  }

  if (creating || hasOwn(payload, "status")) {
    const status = payload.status ?? "ACTIVE";

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw createError("Invalid tax rate status");
    }

    fields.status = status;
  }

  return fields;
};

const createTaxRate = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    const rate = Number(payload.rate);

    if (
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      throw createError("Tax rate must be between 0 and 100");
    }

    const taxType = payload.taxType ?? "GST";

    if (!["GST", "VAT", "CUSTOM"].includes(taxType)) {
      throw createError("Invalid tax type");
    }

    const fields = buildFields(payload, true);

    const [taxRate] = await context.models.TaxRate.create(
      [
        {
          ...fields,
          tenantId: context.tenantId,
          rate,
          taxType,
          isSystem: false,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      {
        session: context.session,
      },
    );

    await audit(context, taxRate, "CREATE");

    return taxRate.toObject();
  });

const getTaxRate = async (args) => {
  const context = resolveContext(args);
  const taxRate = await loadTaxRate(context);

  return taxRate.toObject();
};

const listTaxRates = async (args) => {
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
      throw createError("Invalid tax rate status");
    }

    filter.status = args.status;
  }

  if (args.taxType) {
    if (!["GST", "VAT", "CUSTOM"].includes(args.taxType)) {
      throw createError("Invalid tax type");
    }

    filter.taxType = args.taxType;
  }

  const search = String(args.search ?? "").trim();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [{ name: regex }, { description: regex }];
  }

  const [data, total] = await Promise.all([
    models.TaxRate.find(filter)
      .sort({
        taxType: 1,
        rate: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    models.TaxRate.countDocuments(filter),
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

const updateTaxRate = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};
    const taxRate = await loadTaxRate(context);

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError("A valid tax rate version is required");
    }

    if (taxRate.__v !== payload.version) {
      throw createError("Tax rate changed. Reload before continuing.", 409);
    }

    if (
      !["name", "description", "status"].some((field) => hasOwn(payload, field))
    ) {
      throw createError("Provide at least one editable tax rate field");
    }

    if (
      hasOwn(payload, "rate") ||
      hasOwn(payload, "taxType") ||
      hasOwn(payload, "isSystem")
    ) {
      throw createError(
        "Tax rate value, tax type, and system flag cannot be changed",
      );
    }

    const oldData = taxRate.toObject();

    taxRate.set({
      ...buildFields(payload),
      updatedBy: context.userId,
    });

    await taxRate.save({
      session: context.session,
    });

    await audit(context, taxRate, "UPDATE", oldData);

    return taxRate.toObject();
  });

module.exports = {
  createTaxRate,
  getTaxRate,
  listTaxRates,
  updateTaxRate,
};
