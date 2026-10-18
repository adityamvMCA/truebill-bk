const {
  createInvoiceFromSalesOrder,
} = require("./salesInvoiceFromOrder.service");

const createFromSalesOrder = async (req, res, next) => {
  try {
    const invoice = await createInvoiceFromSalesOrder({
      tenant: req.tenant,

      userId: req.user.userId,

      ipAddress: req.ip,

      orderNumber: req.validatedParams.orderNumber,

      payload: req.validatedBody,
    });

    return res.status(201).json({
      success: true,

      message: "Sales invoice created from Sales Order successfully",

      invoice,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createFromSalesOrder,
};
