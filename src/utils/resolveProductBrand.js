const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const resolveProductBrand = async ({
  models,
  tenantId,
  value,
  session,
  existingBrand = null,
  preserveExisting = false,
}) => {
  const name = normalizeName(value);

  if (!name) {
    return null;
  }

  if (name.length > 100) {
    throw createError("Brand cannot exceed 100 characters");
  }

  const existingName = normalizeName(existingBrand);

  if (
    preserveExisting &&
    existingName &&
    name.toLowerCase() === existingName.toLowerCase()
  ) {
    return existingBrand;
  }

  const { ProductBrand, Product } = models;

  if (!ProductBrand || ProductBrand.db !== Product.db) {
    throw createError(
      "ProductBrand is not registered on the product tenant connection",
      500,
    );
  }

  if (!session || !session.inTransaction()) {
    throw createError("Brand assignment requires an active transaction", 500);
  }

  const brand = await ProductBrand.findOne({
    tenantId,
    normalizedName: name.toLowerCase(),
  })
    .session(session)
    .lean();

  if (!brand) {
    throw createError(
      `Brand "${name}" does not exist. Create it in Inventory Brands first.`,
      409,
    );
  }

  if (brand.status !== "ACTIVE") {
    throw createError(`Brand "${brand.name}" is inactive`, 409);
  }

  const locked = await ProductBrand.updateOne(
    {
      _id: brand._id,
      tenantId,
      status: "ACTIVE",
      __v: brand.__v,
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
    throw createError("Brand changed. Reload the brands and try again.", 409);
  }

  return brand.name;
};

module.exports = {
  resolveProductBrand,
};
