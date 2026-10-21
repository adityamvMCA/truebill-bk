const service = require("./purchaseOrder.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  orderNumber: req.validatedParams?.orderNumber,
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

const listOrders = async (req, res, next) => {
  try {
    const result = await service.listOrders({
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

const getOrder = async (req, res, next) => {
  try {
    const data = await service.getOrder(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listOrders,
  getOrder,

  createOrder: writeHandler(
    "createOrder",
    "Purchase Order created successfully",
    201,
  ),

  updateOrder: writeHandler(
    "updateOrder",
    "Purchase Order updated successfully",
  ),

  cancelOrder: writeHandler(
    "cancelOrder",
    "Purchase Order cancelled successfully",
  ),
};
