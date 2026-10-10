const LedgerGroup = require("./ledgerGroup.model");
const { seedDefaultLedgerGroups } = require("../seeds/seedDefaultLedgerGroups");

const normalizeText = (value) => String(value || "").trim();

const getLedgerGroups = async ({
  tenantId,
  nature,
  includeInactive = false,
}) => {
  const filter = {
    tenantId,
  };

  if (!includeInactive) {
    filter.isActive = true;
  }

  if (nature) {
    filter.nature = String(nature).trim().toUpperCase();
  }

  return LedgerGroup.find(filter)
    .sort({
      nature: 1,
      name: 1,
    })
    .lean();
};

const getLedgerGroupByCode = async ({ tenantId, code }) => {
  return LedgerGroup.findOne({
    tenantId,
    code: String(code).trim().toUpperCase(),
    isActive: true,
  }).lean();
};

const createCustomLedgerGroup = async ({
  tenantId,
  userId,
  code,
  name,
  nature,
  parentGroupId = null,
  description = null,
}) => {
  const normalizedCode = normalizeText(code).toUpperCase();
  const normalizedName = normalizeText(name);
  const normalizedNature = normalizeText(nature).toUpperCase();

  if (!normalizedCode || !normalizedName || !normalizedNature) {
    throw new Error("code, name and nature are required");
  }

  if (!LedgerGroup.NATURES.includes(normalizedNature)) {
    throw new Error(`nature must be one of: ${LedgerGroup.NATURES.join(", ")}`);
  }

  const exists = await LedgerGroup.exists({
    tenantId,
    $or: [{ code: normalizedCode }, { name: normalizedName }],
  });

  if (exists) {
    const error = new Error("Ledger group code or name already exists");
    error.statusCode = 409;
    throw error;
  }

  return LedgerGroup.create({
    tenantId,
    code: normalizedCode,
    name: normalizedName,
    nature: normalizedNature,
    parentGroupId,
    isPrimary: false,
    isSystem: false,
    isActive: true,
    description: normalizeText(description) || null,
    createdBy: userId,
    updatedBy: userId,
  });
};

const seedLedgerGroupsForTenant = async ({ tenantId, userId }) => {
  return seedDefaultLedgerGroups({
    tenantId,
    userId,
  });
};

module.exports = {
  getLedgerGroups,
  getLedgerGroupByCode,
  createCustomLedgerGroup,
  seedLedgerGroupsForTenant,
};
