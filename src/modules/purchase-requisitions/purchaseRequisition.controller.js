const service = require("./purchaseRequisition.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  requisitionNumber: req.validatedParams?.requisitionNumber,
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

const listRequisitions = async (req, res, next) => {
  try {
    const result = await service.listRequisitions({
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

const getRequisition = async (req, res, next) => {
  try {
    const data = await service.getRequisition(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listRequisitions,
  getRequisition,

  createRequisition: writeHandler(
    "createRequisition",
    "Purchase requisition created successfully",
    201,
  ),

  updateRequisition: writeHandler(
    "updateRequisition",
    "Purchase requisition updated successfully",
  ),

  approveRequisition: writeHandler(
    "approveRequisition",
    "Purchase requisition approved successfully",
  ),

  rejectRequisition: writeHandler(
    "rejectRequisition",
    "Purchase requisition rejected successfully",
  ),

  cancelRequisition: writeHandler(
    "cancelRequisition",
    "Purchase requisition cancelled successfully",
  ),

  deleteRequisition: writeHandler(
    "deleteRequisition",
    "Purchase requisition deleted successfully",
  ),
};
