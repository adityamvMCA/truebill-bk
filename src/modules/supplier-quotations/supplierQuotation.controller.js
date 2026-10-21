const service = require("./supplierQuotation.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  quotationNumber: req.validatedParams?.quotationNumber,
  payload: req.validatedBody,
});

const writeHandler =
  (method, message, statusCode = 200) =>
  async (req, res, next) => {
    try {
      const data = await service[method](getContext(req));

      return res.status(statusCode).json({
        success: true,
        message,
        data,
      });
    } catch (error) {
      return next(error);
    }
  };

const listQuotations = async (req, res, next) => {
  try {
    const result = await service.listQuotations({
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

const getQuotation = async (req, res, next) => {
  try {
    const data = await service.getQuotation(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listQuotations,
  getQuotation,

  createQuotation: writeHandler(
    "createQuotation",
    "Supplier quotation created successfully",
    201,
  ),

  updateQuotation: writeHandler(
    "updateQuotation",
    "Supplier quotation updated successfully",
  ),

  cancelQuotation: writeHandler(
    "cancelQuotation",
    "Supplier quotation cancelled successfully",
  ),

  deleteQuotation: writeHandler(
    "deleteQuotation",
    "Supplier quotation deleted successfully",
  ),
};
