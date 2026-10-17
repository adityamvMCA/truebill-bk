// const { getOutstanding } = require("./outstanding.service");

// const createHandler = (kind) => async (req, res, next) => {
//   try {
//     const result = await getOutstanding({
//       ...req.validatedQuery,
//       tenantId: req.tenantId,
//       kind,
//     });

//     return res.status(200).json({
//       success: true,
//       ...result,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// module.exports = {
//   getCustomerOutstanding: createHandler("customer"),
//   getSupplierOutstanding: createHandler("supplier"),
// };

const { getOutstanding } = require("./outstanding.service");

const createHandler = (kind) => async (req, res, next) => {
  try {
    const result = await getOutstanding({
      ...req.validatedQuery,
      tenant: req.tenant,
      kind,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCustomerOutstanding: createHandler("customer"),
  getSupplierOutstanding: createHandler("supplier"),
};
