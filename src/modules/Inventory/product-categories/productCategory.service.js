const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../../utils/sequenceGenerator");

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

const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const optionalText = (value) => String(value ?? "").trim() || null;

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const resolveContext = (args) => {
  if (!args.tenant?._id) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(args.tenant);

  const models = getTenantAccountingModels(connection);

  for (const name of ["ProductCategory", "AuditLog"]) {
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
      throw createError("Category name or category code already exists", 409);
    }

    if (error.name === "VersionError") {
      throw createError("Category changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const loadCategory = async (context) => {
  const categoryCode = String(context.categoryCode ?? "")
    .trim()
    .toUpperCase();

  if (!categoryCode || ["UNDEFINED", "NULL"].includes(categoryCode)) {
    throw createError("A valid category code is required");
  }

  const category = await context.models.ProductCategory.findOne({
    tenantId: context.tenantId,
    categoryCode,
  }).session(context.session ?? null);

  if (!category) {
    throw createError("Product category not found", 404);
  }

  return category;
};

const createAudit = async (context, category, action, oldData = null) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: "PRODUCT_CATEGORY",
        documentId: category._id,
        oldData,
        newData: category.toObject(),
        ipAddress: context.ipAddress,
      },
    ],
    {
      session: context.session,
    },
  );
};

const createCategory = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};

    const name = normalizeName(payload.name);

    if (!name || name.length > 100) {
      throw createError("Category name must contain 1–100 characters");
    }

    const status = payload.status ?? "ACTIVE";

    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw createError("Invalid category status");
    }

    const description = optionalText(payload.description);

    if (description && description.length > 1000) {
      throw createError("Description cannot exceed 1000 characters");
    }

    const normalizedName = name.toLowerCase();

    const existing = await context.models.ProductCategory.exists({
      tenantId: context.tenantId,
      normalizedName,
    }).session(context.session);

    if (existing) {
      throw createError("A category with this name already exists", 409);
    }

    const categoryCode = await getNextSequence(
      "CAT",
      String(context.tenantId),
      3,
      {
        connection: context.connection,
        session: context.session,
      },
    );

    const [category] = await context.models.ProductCategory.create(
      [
        {
          tenantId: context.tenantId,
          categoryCode,
          name,
          normalizedName,
          description,
          status,
          createdBy: context.userId,
          updatedBy: context.userId,
        },
      ],
      {
        session: context.session,
      },
    );

    await createAudit(context, category, "CREATE");

    return category.toObject();
  });

const getCategory = async (args) => {
  const context = resolveContext(args);

  const category = await loadCategory(context);

  return category.toObject();
};

const listCategories = async (args) => {
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
      throw createError("Invalid category status");
    }

    filter.status = args.status;
  }

  const search = String(args.search ?? "").trim();

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const regex = new RegExp(escaped, "i");

    filter.$or = [
      { categoryCode: regex },
      { name: regex },
      { description: regex },
    ];
  }

  const [data, total] = await Promise.all([
    models.ProductCategory.find(filter)
      .sort({
        name: 1,
        _id: 1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),

    models.ProductCategory.countDocuments(filter),
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

const updateCategory = (args) =>
  transaction(args, async (context) => {
    const payload = args.payload || {};
    const category = await loadCategory(context);

    if (!Number.isSafeInteger(payload.version) || payload.version < 0) {
      throw createError("A valid category version is required");
    }

    if (category.__v !== payload.version) {
      throw createError("Category changed. Reload before continuing.", 409);
    }

    if (!hasOwn(payload, "description") && !hasOwn(payload, "status")) {
      throw createError("Provide description or status");
    }

    if (
      hasOwn(payload, "name") ||
      hasOwn(payload, "normalizedName") ||
      hasOwn(payload, "categoryCode")
    ) {
      throw createError("Category name and code cannot be changed");
    }

    const oldData = category.toObject();

    if (hasOwn(payload, "description")) {
      const description = optionalText(payload.description);

      if (description && description.length > 1000) {
        throw createError("Description cannot exceed 1000 characters");
      }

      category.description = description;
    }

    if (hasOwn(payload, "status")) {
      if (!["ACTIVE", "INACTIVE"].includes(payload.status)) {
        throw createError("Invalid category status");
      }

      category.status = payload.status;
    }

    category.updatedBy = context.userId;

    await category.save({
      session: context.session,
    });

    await createAudit(context, category, "UPDATE", oldData);

    return category.toObject();
  });

module.exports = {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
};
