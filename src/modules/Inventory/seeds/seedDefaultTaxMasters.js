const mongoose = require("mongoose");

const {
  DEFAULT_TAX_RATES,
  DEFAULT_HSN_SAC_CODES,
} = require("./defaultTaxMasters");

const toObjectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw new Error(`${label} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const normalizeName = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const nullableText = (value) => String(value ?? "").trim() || null;

const validateRate = (value, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error(`${label} must be a number between 0 and 100`);
  }

  return value;
};

const seedDefaultTaxMasters = async ({
  models,
  tenantId,
  userId = null,
  session,
}) => {
  const TaxRate = models?.TaxRate;
  const HsnSacCode = models?.HsnSacCode;

  if (!TaxRate || !HsnSacCode || TaxRate.db !== HsnSacCode.db) {
    throw new Error(
      "TaxRate and HsnSacCode must use the same tenant connection",
    );
  }

  if (!session || !session.inTransaction()) {
    throw new Error("Default tax seeding requires an active transaction");
  }

  const normalizedTenantId = toObjectId(tenantId, "tenantId");

  const normalizedUserId = userId == null ? null : toObjectId(userId, "userId");

  const taxRates = {
    insertedCount: 0,
    matchedCount: 0,
  };

  const hsnSacCodes = {
    configuredCount: DEFAULT_HSN_SAC_CODES.length,

    insertedCount: 0,
    matchedCount: 0,
  };

  for (const template of DEFAULT_TAX_RATES) {
    const name = normalizeName(template.name);

    if (!name || name.length > 100) {
      throw new Error("Default Tax Rate name must contain 1–100 characters");
    }

    const normalizedName = name.toLowerCase();

    const rate = validateRate(template.rate, `Rate for ${name}`);

    const taxType = template.taxType ?? "GST";

    if (!["GST", "VAT", "CUSTOM"].includes(taxType)) {
      throw new Error(`Invalid tax type for ${name}`);
    }

    const existingRate = await TaxRate.findOne({
      tenantId: normalizedTenantId,
      taxType,
      rate,
    })
      .session(session)
      .lean();

    if (existingRate) {
      taxRates.matchedCount += 1;
      continue;
    }

    const conflictingName = await TaxRate.findOne({
      tenantId: normalizedTenantId,
      normalizedName,
    })
      .session(session)
      .lean();

    if (conflictingName) {
      throw new Error(
        `Cannot seed ${name}: its name already belongs to a different tax type or rate. Existing records were not overwritten.`,
      );
    }

    await TaxRate.create(
      [
        {
          tenantId: normalizedTenantId,
          name,
          normalizedName,
          rate,
          taxType,

          description:
            "Default rate option. Verify applicability for the Product and transaction.",

          status: "ACTIVE",
          isSystem: true,

          createdBy: normalizedUserId,
          updatedBy: normalizedUserId,
        },
      ],
      {
        session,
      },
    );

    taxRates.insertedCount += 1;
  }

  for (const template of DEFAULT_HSN_SAC_CODES) {
    const code = String(template.code ?? "")
      .trim()
      .toUpperCase();

    if (!/^[A-Z0-9]{2,20}$/.test(code)) {
      throw new Error("A default HSN/SAC entry has an invalid code");
    }

    const description = nullableText(template.description);

    if (description && description.length > 500) {
      throw new Error(`HSN/SAC description exceeds 500 characters for ${code}`);
    }

    const defaultGstRate = validateRate(
      template.defaultGstRate,
      `Approved default GST rate for ${code}`,
    );

    const existingCode = await HsnSacCode.findOne({
      tenantId: normalizedTenantId,
      code,
    })
      .session(session)
      .lean();

    if (existingCode) {
      hsnSacCodes.matchedCount += 1;
      continue;
    }

    await HsnSacCode.create(
      [
        {
          tenantId: normalizedTenantId,
          code,
          description,
          defaultGstRate,
          status: "ACTIVE",

          createdBy: normalizedUserId,
          updatedBy: normalizedUserId,
        },
      ],
      {
        session,
      },
    );

    hsnSacCodes.insertedCount += 1;
  }

  return {
    taxRates,
    hsnSacCodes,
  };
};

module.exports = {
  seedDefaultTaxMasters,
};
