const service = require("./stockValuation.service");

const getStockValuation = async (req, res, next) => {
  try {
    const result = await service.getStockValuation({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      summary: result.summary,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getCategoryValuation = async (req, res, next) => {
  try {
    const data = await service.getCategoryValuation({
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getStockValuation,
  getCategoryValuation,
};