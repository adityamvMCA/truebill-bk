const ledgerService = require("./ledger.service");

const getAllLedgers = async (req, res, next) => {
  try {
    const ledgers = await ledgerService.getLedgers({
      tenantId: req.user.tenantId,
      groupCode: req.query.groupCode,
      type: req.query.type,
      nature: req.query.nature,
      includeInactive: req.query.includeInactive === "true",
    });

    return res.status(200).json({
      success: true,
      total: ledgers.length,
      data: ledgers,
    });
  } catch (error) {
    next(error);
  }
};

const seedLedgers = async (req, res, next) => {
  try {
    const result = await ledgerService.seedLedgersForTenant({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
    });

    return res.status(200).json({
      success: true,
      message: "Default system ledgers seeded successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const createLedger = async (req, res, next) => {
  try {
    const ledger = await ledgerService.createLedger({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      ...req.body,
    });

    return res.status(201).json({
      success: true,
      message: "Ledger created successfully",
      data: ledger,
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
  getAllLedgers,
  seedLedgers,
  createLedger,
};