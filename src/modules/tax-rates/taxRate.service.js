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

const SORTS = {
  name: (d) => ({ normalizedName: d }),
  rate: (d) => ({ rate: d, _id: d }),
  taxType: (d) => ({ taxType: d, rate: d, _id: d }),
  status: (d) => ({ status: d, taxType: d, rate: d, _id: d }),
  createdAt: (d) => ({ createdAt: d, _id: d }),
  updatedAt: (d) => ({ updatedAt: d, _id: d }),
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

  const search = normalizeName(args.search).toLowerCase();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Anchored prefix on the lowercase field: uses the {tenantId, normalizedName} index
    filter.normalizedName = { $regex: `^${escaped}` };
  }

  const direction = args.sortDir === "desc" ? -1 : 1;

  const sort = SORTS[args.sortBy]
    ? SORTS[args.sortBy](direction)
    : { taxType: 1, rate: 1, _id: 1 };

  const [data, total] = await Promise.all([
    models.TaxRate.find(filter).sort(sort).skip(skip).limit(limit).lean(),

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

const getTaxRateCounts = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const [result] = await models.TaxRate.aggregate([
    { $match: { tenantId } },
    {
      $facet: {
        status: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        taxTypes: [{ $group: { _id: "$taxType", count: { $sum: 1 } } }],
      },
    },
  ]);

  const status = Object.fromEntries(
    (result?.status ?? []).map((item) => [item._id, item.count]),
  );

  const taxTypes = Object.fromEntries(
    (result?.taxTypes ?? []).map((item) => [item._id, item.count]),
  );

  const active = status.ACTIVE ?? 0;
  const inactive = status.INACTIVE ?? 0;

  return {
    total: active + inactive,
    active,
    inactive,
    taxTypes: { GST: 0, VAT: 0, CUSTOM: 0, ...taxTypes },
  };
};

const bulkUpdateStatus = (args) =>
  transaction(args, async (context) => {
    const { ids, status } = args.payload || {};

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw createError("Invalid tax rate status");
    }

    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) {
      throw createError("Provide between 1 and 1000 tax rate IDs");
    }

    const objectIds = [...new Set(ids.map((id) => String(id)))].map((id) =>
      objectId(id, "taxRateId"),
    );

    const existing = await context.models.TaxRate.find({
      tenantId: context.tenantId,
      _id: { $in: objectIds },
    })
      .session(context.session)
      .lean();

    const changing = existing.filter((item) => item.status !== status);

    if (changing.length) {
      const result = await context.models.TaxRate.updateMany(
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
        throw createError("Tax rates changed. Reload before continuing.", 409);
      }

      const now = new Date();

      await context.models.AuditLog.insertMany(
        changing.map((oldData) => ({
          tenantId: context.tenantId,
          userId: context.userId,
          action: "UPDATE",
          module: "TAX_RATE",
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
  getTaxRateCounts,
  bulkUpdateStatus,
  updateTaxRate,
};
