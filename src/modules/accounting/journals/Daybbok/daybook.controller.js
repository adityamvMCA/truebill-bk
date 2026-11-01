// // src/modules/accounting/journals/daybook.controller.js

// const { getReadyTenantConnection } = require("../../../../tenancy/tenantConnectionManager");
// const { getDayBook } = require("./daybook.service");

// const getDayBookHandler = async (req, res, next) => {
//   try {
//     const connection = getReadyTenantConnection(req.tenant);
//     const result = await getDayBook({
//       tenant: req.tenant,
//       connection,
//       query: req.query,
//     });

//     return res.status(200).json({
//       success: true,
//       data: {
//         period: result.period,
//         totals: result.totals,
//         typeWise: result.typeWise,
//         ledger: null,
//       },
//       transactions: result.transactions,
//       pagination: result.pagination,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// module.exports = { getDayBookHandler };
// src/modules/accounting/journals/daybook.controller.js

const { getReadyTenantConnection } = require("../../../../tenancy/tenantConnectionManager");
const { getDayBook, getDayBookList, getDayBookSummary } = require("./daybook.service");

const getDayBookHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await getDayBook({
      tenant: req.tenant,
      connection,
      query: req.query,
    });

    return res.status(200).json({
      success: true,
      data: {
        period: result.period,
        totals: result.totals,
        typeWise: result.typeWise,
        ledger: null,
      },
      transactions: result.transactions,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

// ---- FAST (added) ----
const getDayBookListHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await getDayBookList({
      tenant: req.tenant,
      connection,
      query: req.query,
    });

    return res.status(200).json({
      success: true,
      transactions: result.transactions,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getDayBookSummaryHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const data = await getDayBookSummary({
      tenant: req.tenant,
      connection,
      query: req.query,
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getDayBookHandler, getDayBookListHandler, getDayBookSummaryHandler };