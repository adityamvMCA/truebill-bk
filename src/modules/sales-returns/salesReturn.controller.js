const salesReturnService = require("./salesReturn.service");

const getRequestContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getReturnNumber = (req) =>
  req.validatedParams?.returnNumber || req.params.returnNumber;

const createSalesReturn = async (req, res, next) => {
  try {
    const salesReturn = await salesReturnService.createSalesReturn({
      ...getRequestContext(req),
      payload: req.body,
    });

    return res.status(201).json({
      success: true,
      message: "Sales return created successfully",
      salesReturn,
    });
  } catch (error) {
    return next(error);
  }
};

const getSalesReturns = async (req, res, next) => {
  try {
    const result = await salesReturnService.getSalesReturns({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getSalesReturnByNumber = async (req, res, next) => {
  try {
    const salesReturn = await salesReturnService.getSalesReturnByNumber({
      tenant: req.tenant,
      returnNumber: getReturnNumber(req),
    });

    return res.status(200).json({
      success: true,
      salesReturn,
    });
  } catch (error) {
    return next(error);
  }
};

const updateSalesReturn = async (req, res, next) => {
  try {
    const salesReturn = await salesReturnService.updateSalesReturn({
      ...getRequestContext(req),
      returnNumber: getReturnNumber(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales return updated successfully",
      salesReturn,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteSalesReturn = async (req, res, next) => {
  try {
    await salesReturnService.deleteSalesReturn({
      ...getRequestContext(req),
      returnNumber: getReturnNumber(req),
    });

    return res.status(200).json({
      success: true,
      message: "Sales return deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const postSalesReturn = async (req, res, next) => {
  try {
    const salesReturn = await salesReturnService.postSalesReturn({
      ...getRequestContext(req),
      returnNumber: getReturnNumber(req),
    });

    return res.status(200).json({
      success: true,
      message: "Sales return posted successfully",
      salesReturn,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createSalesReturn,
  getSalesReturns,
  getSalesReturnByNumber,
  updateSalesReturn,
  deleteSalesReturn,
  postSalesReturn,
};
