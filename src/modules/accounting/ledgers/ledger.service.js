const Ledger = require("./ledger.model");
const LedgerGroup = require("../ledger-groups/ledgerGroup.model");
const {
  seedDefaultLedgers,
} = require("../seeds/seedDefaultLedgers");

const NORMAL_BALANCE_BY_NATURE = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  INCOME: "CREDIT",
  EQUITY: "CREDIT",
};

const normalizeText = (value) => String(value || "").trim();

const getLedgers = async ({
  tenantId,
  groupCode,
  type,
  nature,
  includeInactive = false,
}) => {
  const filter = {
    tenantId,
  };

  if (!includeInactive) {
    filter.isActive = true;
  }

  if (type) {
    filter.type = String(type).trim().toUpperCase();
  }

  if (nature) {
    filter.nature = String(nature).trim().toUpperCase();
  }

  if (groupCode) {
    const group = await LedgerGroup.findOne({
      tenantId,
      code: String(groupCode).trim().toUpperCase(),
      isActive: true,
    })
      .select("_id")
      .lean();

    if (!group) {
      return [];
    }

    filter.ledgerGroupId = group._id;
  }

  return Ledger.find(filter)
    .populate("ledgerGroupId", "code name nature")
    .sort({
      name: 1,
    })
    .lean();
};

const createLedger = async ({
  tenantId,
  userId,
  ledgerGroupId,
  code,
  name,
  type = "ACCOUNT",
  openingBalance = 0,
  openingBalanceType,
  description = null,
  referenceType = null,
  referenceId = null,
  creditLimit = 0,
  creditDays = 0,
}) => {
  const group = await LedgerGroup.findOne({
    _id: ledgerGroupId,
    tenantId,
    isActive: true,
  }).lean();

  if (!group) {
    const error = new Error("Ledger group not found");
    error.statusCode = 404;
    throw error;
  }

  const normalizedCode = normalizeText(code).toUpperCase();
  const normalizedName = normalizeText(name);

  if (!normalizedCode || !normalizedName) {
    const error = new Error("code and name are required");
    error.statusCode = 400;
    throw error;
  }

  const normalBalance = NORMAL_BALANCE_BY_NATURE[group.nature];

  const exists = await Ledger.exists({
    tenantId,
    $or: [
      { code: normalizedCode },
      { name: normalizedName },
    ],
  });

  if (exists) {
    const error = new Error("Ledger code or name already exists");
    error.statusCode = 409;
    throw error;
  }

  const amount = Number(openingBalance) || 0;
  const balanceType = openingBalanceType || normalBalance;

  return Ledger.create({
    tenantId,
    ledgerGroupId: group._id,
    code: normalizedCode,
    name: normalizedName,
    type: String(type).trim().toUpperCase(),
    nature: group.nature,
    normalBalance,
    openingBalance: amount,
    openingBalanceType: balanceType,
    currentBalance: amount,
    currentBalanceType: balanceType,
    referenceType,
    referenceId,
    creditLimit: Number(creditLimit) || 0,
    creditDays: Number(creditDays) || 0,
    isSystem: false,
    isActive: true,
    description: normalizeText(description) || null,
    createdBy: userId,
    updatedBy: userId,
  });
};

const seedLedgersForTenant = async ({ tenantId, userId }) => {
  return seedDefaultLedgers({
    tenantId,
    userId,
  });
};

module.exports = {
  getLedgers,
  createLedger,
  seedLedgersForTenant,
};