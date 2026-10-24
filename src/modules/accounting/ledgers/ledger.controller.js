const ledgerService = require("./ledger.service");

const mongoose = require("mongoose");
// const getAllLedgers = async (req, res, next) => {
//   try {
//     const ledgers = await ledgerService.getLedgers({
//       tenantId: req.tenantId,
//       groupCode: req.query.groupCode,
//       type: req.query.type,
//       nature: req.query.nature,
//       includeInactive: req.query.includeInactive === "true",
//     });

//     return res.status(200).json({
//       success: true,
//       total: ledgers.length,
//       data: ledgers,
//     });
//   } catch (error) {
//     next(error);
//   }
// };
const { getReadyTenantConnection } = require("../../../tenancy/tenantConnectionManager");

const getAllLedgers = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);

    const ledgers = await ledgerService.getLedgers({
      tenantId: new mongoose.Types.ObjectId(String(req.tenant._id ?? req.tenant.id)),
      connection,
      groupCode: req.query.groupCode,
      type: req.query.type,
      nature: req.query.nature,
      search: req.query.search,
      includeInactive: req.query.includeInactive === "true",
    });

    return res.status(200).json({ success: true, count: ledgers.length, data: ledgers });
  } catch (error) {
    return next(error);
  }
};
const seedLedgers = async (req, res, next) => {
  try {
    const result = await ledgerService.seedLedgersForTenant({
      tenantId: req.tenantId,
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
      tenantId: req.tenantId,
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