const mongoose = require("mongoose");

const DEFAULT_PRODUCT_UNITS = [
  {
    unitCode: "PCS",
    name: "Pieces",
    symbol: "pcs",
  },
  {
    unitCode: "NOS",
    name: "Numbers",
    symbol: "nos",
  },
  {
    unitCode: "BOX",
    name: "Box",
    symbol: "box",
  },
  {
    unitCode: "BAG",
    name: "Bag",
    symbol: "bag",
  },
  {
    unitCode: "PACK",
    name: "Pack",
    symbol: "pack",
  },
  {
    unitCode: "SET",
    name: "Set",
    symbol: "set",
  },
  {
    unitCode: "KG",
    name: "Kilogram",
    symbol: "kg",
  },
  {
    unitCode: "GRAM",
    name: "Gram",
    symbol: "g",
  },
  {
    unitCode: "TON",
    name: "Ton",
    symbol: "ton",
  },
  {
    unitCode: "LTR",
    name: "Litre",
    symbol: "L",
  },
  {
    unitCode: "ML",
    name: "Millilitre",
    symbol: "mL",
  },
  {
    unitCode: "MTR",
    name: "Metre",
    symbol: "m",
  },
  {
    unitCode: "FEET",
    name: "Feet",
    symbol: "ft",
  },
  {
    unitCode: "SQFT",
    name: "Square Feet",
    symbol: "sq ft",
  },
  {
    unitCode: "SQM",
    name: "Square Metre",
    symbol: "sq m",
  },
  {
    unitCode: "HOUR",
    name: "Hour",
    symbol: "hr",
  },
  {
    unitCode: "DAY",
    name: "Day",
    symbol: "day",
  },
  {
    unitCode: "MONTH",
    name: "Month",
    symbol: "month",
  },
];

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

const seedDefaultProductUnits = async ({
  models,
  tenantId,
  userId = null,
  session,
}) => {
  const ProductUnit = models?.ProductUnit;

  if (!ProductUnit?.db) {
    throw new Error("Tenant ProductUnit model is required");
  }

  if (!session || !session.inTransaction()) {
    throw new Error("Default Unit seeding requires an active transaction");
  }

  const normalizedTenantId = toObjectId(tenantId, "tenantId");

  const normalizedUserId = userId == null ? null : toObjectId(userId, "userId");

  let insertedCount = 0;
  let matchedCount = 0;

  const nameConflicts = [];

  for (const template of DEFAULT_PRODUCT_UNITS) {
    const existingByCode = await ProductUnit.findOne({
      tenantId: normalizedTenantId,
      unitCode: template.unitCode,
    })
      .session(session)
      .lean();

    if (existingByCode) {
      matchedCount += 1;
      continue;
    }

    const name = normalizeName(template.name);

    const normalizedName = name.toLowerCase();

    const existingByName = await ProductUnit.findOne({
      tenantId: normalizedTenantId,
      normalizedName,
    })
      .session(session)
      .lean();

    if (existingByName) {
      nameConflicts.push({
        requestedCode: template.unitCode,
        existingCode: existingByName.unitCode,
        name: existingByName.name,
      });

      continue;
    }

    await ProductUnit.create(
      [
        {
          tenantId: normalizedTenantId,
          unitCode: template.unitCode,
          name,
          normalizedName,
          symbol: template.symbol,
          description: null,
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

    insertedCount += 1;
  }

  return {
    insertedCount,
    matchedCount,
    skippedCount: nameConflicts.length,
    nameConflicts,
  };
};

module.exports = {
  DEFAULT_PRODUCT_UNITS,
  seedDefaultProductUnits,
};
