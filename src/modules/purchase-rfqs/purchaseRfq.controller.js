const service = require("./purchaseRfq.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  rfqNumber: req.validatedParams?.rfqNumber,
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

const listRfqs = async (req, res, next) => {
  try {
    const result = await service.listRfqs({
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

const getRfq = async (req, res, next) => {
  try {
    const data = await service.getRfq(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listRfqs,
  getRfq,

  createRfq: writeHandler("createRfq", "RFQ created successfully", 201),

  updateRfq: writeHandler("updateRfq", "RFQ updated successfully"),

  issueRfq: writeHandler("issueRfq", "RFQ marked as issued successfully"),

  closeRfq: writeHandler("closeRfq", "RFQ closed successfully"),

  cancelRfq: writeHandler("cancelRfq", "RFQ cancelled successfully"),

  deleteRfq: writeHandler("deleteRfq", "RFQ deleted successfully"),
};
