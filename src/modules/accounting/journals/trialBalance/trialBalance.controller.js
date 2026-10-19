// src/modules/accounting/reports/trialBalance.controller.js

const { getReadyTenantConnection } = require("../../../../tenancy/tenantConnectionManager");
const { getTrialBalance } = require("./trialBalance.service");

const getTrialBalanceHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await getTrialBalance({
      tenant: req.tenant,
      connection,
      query: req.query,
    });

    return res.status(200).json({
      success: true,
      data: {
        asOfDate: result.asOfDate,
        timezone: result.timezone,
        totals: result.totals,
        count: result.count,
      },
      rows: result.rows,
      // alias for older frontend expects
      transactions: [],
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getTrialBalanceHandler };
