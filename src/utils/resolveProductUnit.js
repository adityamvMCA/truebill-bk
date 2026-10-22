const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const resolveProductUnit = async ({
  models,
  tenantId,
  value,
  session,
  existingUnit = null,
  preserveExisting = false,
}) => {
  const unitCode = normalizeCode(value);

  if (!unitCode) {
    throw createError(
      "A valid unit code is required",
    );
  }

  if (
    !/^[A-Z][A-Z0-9_]{0,19}$/.test(unitCode)
  ) {
    throw createError(
      "Unit code must start with a letter and contain up to 20 letters, numbers, or underscores",
    );
  }

  if (
    preserveExisting &&
    unitCode === normalizeCode(existingUnit)
  ) {
    return existingUnit;
  }

  const { ProductUnit, Product } = models;

  if (
    !ProductUnit ||
    ProductUnit.db !== Product.db
  ) {
    throw createError(
      "ProductUnit is not registered on the product tenant connection",
      500,
    );
  }

  if (!session || !session.inTransaction()) {
    throw createError(
      "Unit assignment requires an active transaction",
      500,
    );
  }

  const unit = await ProductUnit.findOne({
    tenantId,
    unitCode,
  })
    .session(session)
    .lean();

  if (!unit) {
    throw createError(
      `Unit "${unitCode}" does not exist. Create it in Inventory Units first.`,
      409,
    );
  }

  if (unit.status !== "ACTIVE") {
    throw createError(
      `Unit "${unitCode}" is inactive`,
      409,
    );
  }

  const locked = await ProductUnit.updateOne(
    {
      _id: unit._id,
      tenantId,
      status: "ACTIVE",
      __v: unit.__v,
    },
    {
      $inc: {
        __v: 1,
      },
    },
    {
      session,
      timestamps: false,
    },
  );

  if (locked.modifiedCount !== 1) {
    throw createError(
      "Unit changed. Reload the units and try again.",
      409,
    );
  }

  return unit.unitCode;
};

module.exports = {
  resolveProductUnit,
};