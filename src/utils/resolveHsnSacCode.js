const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const resolveHsnSacCode = async ({
  models,
  tenantId,
  value,
  session,
  existingCode = null,
  preserveExisting = false,
}) => {
  const code = normalizeCode(value);

  if (!code) {
    return null;
  }

  if (!/^[A-Z0-9]{2,20}$/.test(code)) {
    throw createError("HSN/SAC code must contain 2–20 letters or numbers");
  }

  if (preserveExisting && code === normalizeCode(existingCode)) {
    return existingCode;
  }

  const { HsnSacCode, Product } = models;

  if (!HsnSacCode || HsnSacCode.db !== Product.db) {
    throw createError(
      "HsnSacCode is not registered on the product tenant connection",
      500,
    );
  }

  if (!session || !session.inTransaction()) {
    throw createError("HSN/SAC assignment requires an active transaction", 500);
  }

  const record = await HsnSacCode.findOne({
    tenantId,
    code,
  })
    .session(session)
    .lean();

  if (!record) {
    throw createError(
      `HSN/SAC code "${code}" does not exist. Create it in HSN/SAC Codes first.`,
      409,
    );
  }

  if (record.status !== "ACTIVE") {
    throw createError(`HSN/SAC code "${code}" is inactive`, 409);
  }

  const locked = await HsnSacCode.updateOne(
    {
      _id: record._id,
      tenantId,
      status: "ACTIVE",
      __v: record.__v,
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
    throw createError("HSN/SAC code changed. Reload and try again.", 409);
  }

  return record.code;
};

module.exports = {
  resolveHsnSacCode,
};
