const ledgerGroupService = require("./ledgerGroup.service");

const getGroups = async (req, res, next) => {
  try {
    const groups = await ledgerGroupService.getLedgerGroups({
      tenantId: req.user.tenantId,
      nature: req.query.nature,
      includeInactive: req.query.includeInactive === "true",
    });

    return res.status(200).json({
      success: true,
      total: groups.length,
      data: groups,
    });
  } catch (error) {
    next(error);
  }
};

const seedGroups = async (req, res, next) => {
  try {
    const result = await ledgerGroupService.seedLedgerGroupsForTenant({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
    });

    return res.status(200).json({
      success: true,
      message: "Default Tally-style ledger groups seeded successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const createGroup = async (req, res, next) => {
  try {
    const group = await ledgerGroupService.createCustomLedgerGroup({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      ...req.body,
    });

    return res.status(201).json({
      success: true,
      message: "Ledger group created successfully",
      data: group,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
};

module.exports = {
  getGroups,
  seedGroups,
  createGroup,
};