const mongoose = require("mongoose");
const { getNextSequence } = require("../../../utils/sequenceGenerator");
const defaults = require("./masterDefaults");

const configurations = {
  category: {
    modelKey: "ProductCategory",
    codeField: "categoryCode",
    prefix: "CAT",
    module: "PRODUCT_CATEGORY",
    defaults: defaults.categories,
  },
  brand: {
    modelKey: "ProductBrand",
    codeField: "brandCode",
    prefix: "BRD",
    module: "PRODUCT_BRAND",
    defaults: defaults.brands,
  },
};
const createError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value))
    throw createError(`${label} must be a valid ObjectId`);
  return new mongoose.Types.ObjectId(String(value));
};
const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
const nullableText = (value) => String(value ?? "").trim() || null;
const hasOwn = (object, field) =>
  Object.prototype.hasOwnProperty.call(object, field);

const nextCode = async (context, config) => {
  while (true) {
    const code = await getNextSequence(
      config.prefix,
      String(context.tenantId),
      3,
      {
        connection: context.connection,
        session: context.session,
      },
    );
    if (
      typeof code !== "string" ||
      !new RegExp(`^${config.prefix}\\d+$`).test(code) ||
      code.length > 100
    ) {
      throw createError(`Invalid ${config.prefix} sequence result`, 500);
    }
    const exists = await context.models[config.modelKey]
      .exists({
        tenantId: context.tenantId,
        [config.codeField]: code,
      })
      .session(context.session);
    if (!exists) return code;
  }
};

const audit = async (
  context,
  config,
  document,
  action,
  oldData = null,
  extra = {},
) => {
  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        action,
        module: config.module,
        documentId: document._id,
        oldData,
        newData: { ...document.toObject(), ...extra },
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session },
  );
};

const createRecord = async (context, config, payload, seedKey) => {
  const name = normalizeName(payload.name);
  if (!name || name.length > 100)
    throw createError("Name must contain 1–100 characters");
  const description = nullableText(payload.description);
  if (description && description.length > 1000)
    throw createError("Description cannot exceed 1000 characters");
  const status = payload.status ?? "ACTIVE";
  if (!["ACTIVE", "INACTIVE"].includes(status))
    throw createError("Invalid status");
  const model = context.models[config.modelKey];
  if (
    await model
      .exists({
        tenantId: context.tenantId,
        normalizedName: name.toLowerCase(),
      })
      .session(context.session)
  ) {
    throw createError("A record with this name already exists", 409);
  }
  const code = await nextCode(context, config);
  const [document] = await model.create(
    [
      {
        tenantId: context.tenantId,
        [config.codeField]: code,
        name,
        normalizedName: name.toLowerCase(),
        ...(seedKey ? { seedKey } : {}),
        description,
        status,
        createdBy: context.userId,
        updatedBy: context.userId,
      },
    ],
    { session: context.session },
  );
  await audit(context, config, document, "CREATE");
  return document;
};

const seedKind = async (context, config) => {
  const model = context.models[config.modelKey];
  let codesAssigned = 0;
  let insertedCount = 0;
  let matchedCount = 0;
  const missingFilter = {
    tenantId: context.tenantId,
    $or: [
      { [config.codeField]: { $exists: false } },
      { [config.codeField]: null },
      { [config.codeField]: "" },
    ],
  };
  const missing = await model
    .find(missingFilter)
    .sort({ _id: 1 })
    .limit(5001)
    .session(context.session)
    .lean();
  if (missing.length > 5000)
    throw createError(
      "More than 5000 records need code backfill. Use a dedicated maintenance migration.",
      409,
    );
  for (const record of missing) {
    const code = await nextCode(context, config);
    await model.collection.updateOne(
      { _id: record._id, tenantId: context.tenantId },
      {
        $set: { [config.codeField]: code },
        $inc: { __v: 1 },
      },
      { session: context.session },
    );
    const document = await model
      .findOne({ _id: record._id, tenantId: context.tenantId })
      .session(context.session);
    await audit(context, config, document, "UPDATE", record);
    codesAssigned += 1;
  }
  for (const template of config.defaults) {
    const bySeed = await model
      .findOne({ tenantId: context.tenantId, seedKey: template.key })
      .session(context.session);
    if (bySeed) {
      matchedCount += 1;
      continue;
    }
    const existing = await model
      .findOne({
        tenantId: context.tenantId,
        normalizedName: normalizeName(template.name).toLowerCase(),
      })
      .session(context.session);
    if (existing) {
      if (!existing.seedKey) {
        const oldData = existing.toObject();
        await model.collection.updateOne(
          { _id: existing._id, tenantId: context.tenantId },
          {
            $set: { seedKey: template.key },
            $inc: { __v: 1 },
          },
          { session: context.session },
        );
        const current = await model
          .findOne({ _id: existing._id, tenantId: context.tenantId })
          .session(context.session);
        await audit(context, config, current, "UPDATE", oldData);
      }
      matchedCount += 1;
      continue;
    }
    await createRecord(context, config, template, template.key);
    insertedCount += 1;
  }
  return { insertedCount, matchedCount, codesAssigned };
};

module.exports = {
  configurations,
  createError,
  objectId,
  normalizeName,
  nullableText,
  hasOwn,
  nextCode,
  audit,
  createRecord,
  seedKind,
};
