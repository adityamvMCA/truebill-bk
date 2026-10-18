const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const LEDGER_FIELDS = [
  "outputCgstLedgerId",
  "outputSgstLedgerId",
  "outputIgstLedgerId",
  "inputCgstLedgerId",
  "inputSgstLedgerId",
  "inputIgstLedgerId",
];

const REGISTRATION_TYPES = ["REGULAR", "COMPOSITION", "UNREGISTERED"];
const GST_RATES = [0, 5, 12, 18, 28];
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return value;
};

const resolveContext = ({ tenant }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  validateObjectId(tenantId, "tenantId");

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["TaxConfiguration", "Ledger", "AuditLog"]) {
    if (!models[name]) {
      throw createError(`Tenant model ${name} is unavailable`, 500);
    }
  }

  return { tenantId, connection, models };
};

const normalizePayload = (payload = {}) => {
  const registrationType = normalizeText(
    payload.registrationType || "REGULAR",
  ).toUpperCase();

  if (!REGISTRATION_TYPES.includes(registrationType)) {
    throw createError("Invalid registration type");
  }

  let gstin = normalizeText(payload.gstin).toUpperCase() || null;
  let stateCode = null;

  if (registrationType === "UNREGISTERED") {
    gstin = null;
    stateCode = normalizeText(payload.stateCode) || null;
  } else {
    if (!gstin || !GSTIN_REGEX.test(gstin)) {
      throw createError("A valid 15-character GSTIN is required");
    }

    stateCode = gstin.slice(0, 2);
  }

  if (stateCode && !/^\d{2}$/.test(stateCode)) {
    throw createError("State code must be two digits");
  }

  const defaultGstRate = Number(payload.defaultGstRate ?? 18);

  if (!GST_RATES.includes(defaultGstRate)) {
    throw createError("Default GST rate must be 0, 5, 12, 18 or 28");
  }

  const data = { registrationType, gstin, stateCode, defaultGstRate };

  for (const field of LEDGER_FIELDS) {
    const value = normalizeText(payload[field]);
    data[field] = value ? validateObjectId(value, field) : null;
  }

  const ids = LEDGER_FIELDS.map((field) => data[field]).filter(Boolean);

  if (new Set(ids.map(String)).size !== ids.length) {
    throw createError("Each tax ledger can be mapped to only one tax type");
  }

  return data;
};

const getTaxConfiguration = async ({ tenant }) => {
  const { models, tenantId } = resolveContext({ tenant });

  const [configuration, ledgers] = await Promise.all([
    models.TaxConfiguration.findOne({ tenantId }).lean(),
    models.Ledger.find({ tenantId, isActive: true })
      .select("_id code name")
      .sort({ code: 1 })
      .lean(),
  ]);

  return { configuration, ledgers };
};

const saveTaxConfiguration = async ({
  tenant,
  userId,
  ipAddress,
  payload = {},
}) => {
  const { models, tenantId, connection } = resolveContext({ tenant });

  validateObjectId(userId, "userId");

  const data = normalizePayload(payload);

  const ledgerIds = LEDGER_FIELDS.map((field) => data[field]).filter(Boolean);

  if (ledgerIds.length) {
    const found = await models.Ledger.find({
      tenantId,
      _id: { $in: ledgerIds },
      isActive: true,
    })
      .select("_id")
      .lean();

    if (found.length !== ledgerIds.length) {
      throw createError(
        "One or more selected ledgers are missing, inactive, or belong to another tenant",
        409,
      );
    }
  }

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const existing = await models.TaxConfiguration.findOne({
        tenantId,
      }).session(session);

      let action;
      let oldData = null;

      if (existing) {
        oldData = existing.toObject();
        Object.assign(existing, data, { updatedBy: userId });
        await existing.save({ session });
        result = existing;
        action = "UPDATE";
      } else {
        const [created] = await models.TaxConfiguration.create(
          [{ tenantId, ...data, createdBy: userId, updatedBy: userId }],
          { session },
        );

        result = created;
        action = "CREATE";
      }

      await models.AuditLog.create(
        [
          {
            tenantId,
            userId,
            action,
            module: "TAX_CONFIGURATION",
            documentId: result._id,
            oldData,
            newData: result.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  getTaxConfiguration,
  saveTaxConfiguration,
};
