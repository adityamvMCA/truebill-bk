const salesOrderService = require(
  "./salesOrder.service",
);

const getRequestContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getOrderNumber = (req) =>
  req.validatedParams.orderNumber;

const createSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.createSalesOrder({
        ...getRequestContext(req),
        payload: req.validatedBody,
      });

    return res.status(201).json({
      success: true,
      message:
        order.status === "CONFIRMED"
          ? "Sales order created and confirmed successfully"
          : "Sales order draft created successfully",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const getSalesOrders = async (
  req,
  res,
  next,
) => {
  try {
    const result =
      await salesOrderService.getSalesOrders({
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

const getSalesOrderByNumber = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.getOrderByNumber({
        tenant: req.tenant,
        orderNumber: getOrderNumber(req),
      });

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const updateSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.updateSalesOrder({
        ...getRequestContext(req),
        orderNumber: getOrderNumber(req),
        payload: req.validatedBody,
        version: req.validatedBody.version,
      });

    return res.status(200).json({
      success: true,
      message:
        "Sales order draft updated successfully",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const confirmSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.confirmSalesOrder({
        ...getRequestContext(req),
        orderNumber: getOrderNumber(req),
        version: req.validatedBody.version,
      });

    return res.status(200).json({
      success: true,
      message:
        "Sales order confirmed successfully",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const startSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.startSalesOrder({
        ...getRequestContext(req),
        orderNumber: getOrderNumber(req),
        version: req.validatedBody.version,
      });

    return res.status(200).json({
      success: true,
      message:
        "Sales order marked as in progress",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const completeSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.completeSalesOrder({
        ...getRequestContext(req),
        orderNumber: getOrderNumber(req),
        version: req.validatedBody.version,
      });

    return res.status(200).json({
      success: true,
      message:
        "Sales order completed successfully",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const cancelSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.cancelSalesOrder({
        ...getRequestContext(req),
        orderNumber: getOrderNumber(req),
        version: req.validatedBody.version,

        cancellationReason:
          req.validatedBody.cancellationReason,
      });

    return res.status(200).json({
      success: true,
      message:
        "Sales order cancelled successfully",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    await salesOrderService.deleteSalesOrder({
      ...getRequestContext(req),
      orderNumber: getOrderNumber(req),
    });

    return res.status(200).json({
      success: true,
      message:
        "Sales order draft deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const convertQuotationToSalesOrder = async (
  req,
  res,
  next,
) => {
  try {
    const order =
      await salesOrderService.convertQuotationToSalesOrder({
        ...getRequestContext(req),

        quotationId:
          req.validatedParams.quotationId,

        payload: req.validatedBody,
      });

    return res.status(201).json({
      success: true,
      message:
        order.status === "CONFIRMED"
          ? "Sales order created and confirmed from quotation successfully"
          : "Sales order draft created from quotation successfully",
      data: order,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createSalesOrder,
  getSalesOrders,
  getSalesOrderByNumber,
  updateSalesOrder,
  confirmSalesOrder,
  startSalesOrder,
  completeSalesOrder,
  cancelSalesOrder,
  deleteSalesOrder,
  convertQuotationToSalesOrder,
};