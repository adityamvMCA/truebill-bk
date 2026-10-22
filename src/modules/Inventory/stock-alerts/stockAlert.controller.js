const service = require("./stockAlert.service");

const getLowStockProducts = async (req, res, next) => {
  try {
    const result = await service.getLowStockProducts({
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

const getStockSummary = async (req, res, next) => {
  try {
    const summary = await service.getStockSummary({
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getLowStockProducts,
  getStockSummary,
};
