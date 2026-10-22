const DEFAULT_PRODUCT_UNITS = [
  ["NOS", "Numbers", "nos"],
  ["PCS", "Pieces", "pcs"],
  ["BOX", "Box", "box"],
  ["BAG", "Bag", "bag"],
  ["PACK", "Pack", "pack"],
  ["SET", "Set", "set"],
  ["KG", "Kilogram", "kg"],
  ["GRAM", "Gram", "g"],
  ["TON", "Ton", "ton"],
  ["LITRE", "Litre", "L"],
  ["ML", "Millilitre", "mL"],
  ["METER", "Meter", "m"],
  ["FEET", "Feet", "ft"],
  ["SQFT", "Square Feet", "sq ft"],
  ["SQM", "Square Meter", "sq m"],
  ["HOUR", "Hour", "hr"],
  ["DAY", "Day", "day"],
  ["MONTH", "Month", "month"],
].map(([unitCode, name, symbol]) => ({
  unitCode,
  name,
  normalizedName: name.toLowerCase(),
  symbol,
}));

const seedDefaultProductUnits = async ({
  models,
  tenantId,
  userId = null,
  session,
}) => {
  const { ProductUnit } = models || {};

  if (!ProductUnit || !tenantId) {
    throw new Error("Tenant ProductUnit model and tenantId are required");
  }

  const operations = DEFAULT_PRODUCT_UNITS.map((unit) => ({
    updateOne: {
      filter: {
        tenantId,
        unitCode: unit.unitCode,
      },

      update: {
        $setOnInsert: {
          tenantId,
          ...unit,
          description: null,
          status: "ACTIVE",
          isSystem: true,
          createdBy: userId,
          updatedBy: userId,
        },
      },

      upsert: true,
    },
  }));

  const options = {
    ordered: true,
  };

  if (session) {
    options.session = session;
  }

  const result = await ProductUnit.bulkWrite(operations, options);

  return {
    insertedCount: result.upsertedCount || 0,
    matchedCount: result.matchedCount || 0,
  };
};

module.exports = {
  DEFAULT_PRODUCT_UNITS,
  seedDefaultProductUnits,
};
