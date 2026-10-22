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

  for (const name of ["ProductBrand", "AuditLog"]) {
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
      throw createError("Brand name already exists", 409);
    }

    if (error.name === "VersionError") {
      throw createError("Brand changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const loadBrand = async (context) => {
  const brand = await context.models.ProductBrand.findOne({
    tenantId: context.tenantId,
    _id: context.brandId,
  }).session(context.session ?? null);

  if (!brand) {
    throw createError("Product brand not found", 404);
  }

  return brand;
};

const audit = async (context, brand, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "PRODUCT_BRAND",
        documentId: brand._id,
        oldData,
        newData: brand.toObject(),
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
      throw createError("Brand name must contain 1–100 characters");
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
      throw createError("Invalid brand status");
    }

    fields.status = status;
  }

  return fields;
};

const createBrand = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    const fields = buildFields(payload, true);

    const [brand] = await context.models.ProductBrand.create(
      [
        {
          ...fields,
          tenantId: context.tenantId,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      {
        session: context.session,
      },
    );

    await audit(context, brand, "CREATE");

    return brand.toObject();
  });

const getBrand = async (args) => {
  const context = resolveContext(args);
  const brand = await loadBrand(context);

  return brand.toObject();
};

const listBrands = async (args) => {
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
      throw createError("Invalid brand status");
    }

    filter.status = args.status;
  }

  const search = String(args.search ?? "").trim();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [{ name: regex }, { description: regex }];
  }

  const [data, total] = await Promise.all([
    models.ProductBrand.find(filter)
      .sort({
        name: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    models.ProductBrand.countDocuments(filter),
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

const updateBrand = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};
    const brand = await loadBrand(context);

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError("A valid brand version is required");
    }

    if (brand.__v !== payload.version) {
      throw createError("Brand changed. Reload before continuing.", 409);
    }

    if (
      !["name", "description", "status"].some((field) => hasOwn(payload, field))
    ) {
      throw createError("Provide at least one editable brand field");
    }

    const oldData = brand.toObject();

    brand.set({
      ...buildFields(payload),
      updatedBy: context.userId,
    });

    await brand.save({
      session: context.session,
    });

    await audit(context, brand, "UPDATE", oldData);

    return brand.toObject();
  });

module.exports = {
  createBrand,
  getBrand,
  listBrands,
  updateBrand,
};
