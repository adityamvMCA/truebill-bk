// src/modules/accounting/reports/balanceSheet.controller.js

const { getReadyTenantConnection } = require("../../../../tenancy/tenantConnectionManager");
const { getBalanceSheet } = require("./balanceSheet.service");

const getBalanceSheetHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await getBalanceSheet({
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
        profitAndLoss: result.profitAndLoss,
        count: result.count,
        // expose sides at top level too for frontend flexibility
        assets: result.assets,
        liabilities: result.liabilities,
        equity: result.equity,
      },
      // flat alias
      rows: [...result.assets, ...result.liabilities, ...result.equity],
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getBalanceSheetHandler };
