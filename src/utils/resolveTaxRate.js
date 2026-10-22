const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const resolveTaxRate = async ({
  models,
  tenantId,
  value,
  session,
  existingRate = null,
  preserveExisting = false,
}) => {
  const rate = Number(value);

  if (!Number.isFinite(rate)) {
    throw createError("A valid tax rate is required");
  }

  if (preserveExisting && rate === Number(existingRate)) {
    return existingRate;
  }

  const { TaxRate, Product } = models;

  if (!TaxRate || TaxRate.db !== Product.db) {
    throw createError(
      "TaxRate is not registered on the product tenant connection",
      500,
    );
  }

  if (!session || !session.inTransaction()) {
    throw createError(
      "Tax rate assignment requires an active transaction",
      500,
    );
  }

  const taxRate = await TaxRate.findOne({
    tenantId,
    rate,
    status: "ACTIVE",
  })
    .session(session)
    .lean();

  if (!taxRate) {
    throw createError(
      `Tax rate "${rate}%" does not exist. Create it in Tax Rates first.`,
      409,
    );
  }

  const locked = await TaxRate.updateOne(
    {
      _id: taxRate._id,
      tenantId,
      status: "ACTIVE",
      __v: taxRate.__v,
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
    throw createError("Tax rate changed. Reload and try again.", 409);
  }

  return taxRate.rate;
};

module.exports = {
  resolveTaxRate,
};
