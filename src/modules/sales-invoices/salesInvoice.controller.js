const salesInvoiceService = require("./salesInvoice.service");

const getRequestContext = (req) => ({
  tenantId: req.tenantId,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getInvoiceNumber = (req) =>
  req.validatedParams?.invoiceNumber || req.params.invoiceNumber;

const createSalesInvoice = async (req, res, next) => {
  try {
    const invoice = await salesInvoiceService.createSalesInvoice({
      ...getRequestContext(req),
      payload: req.body,
    });

    return res.status(201).json({
      success: true,
      message:
        invoice.status === "POSTED"
          ? "Sales invoice created and posted successfully"
          : "Sales invoice draft created successfully",
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

const getSalesInvoices = async (req, res, next) => {
  try {
    const result = await salesInvoiceService.getSalesInvoices({
      ...(req.validatedQuery || {}),
      tenantId: req.tenantId,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getSalesInvoiceByNumber = async (req, res, next) => {
  try {
    const invoice = await salesInvoiceService.getSalesInvoiceByNumber({
      tenantId: req.tenantId,
      invoiceNumber: getInvoiceNumber(req),
    });

    return res.status(200).json({
      success: true,
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

const updateSalesInvoice = async (req, res, next) => {
  try {
    const invoice = await salesInvoiceService.updateSalesInvoice({
      ...getRequestContext(req),
      invoiceNumber: getInvoiceNumber(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales invoice draft updated successfully",
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

const postSalesInvoice = async (req, res, next) => {
  try {
    const invoice = await salesInvoiceService.postSalesInvoice({
      ...getRequestContext(req),
      invoiceNumber: getInvoiceNumber(req),
    });

    return res.status(200).json({
      success: true,
      message: "Sales invoice posted successfully",
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

const deleteSalesInvoice = async (req, res, next) => {
  try {
    await salesInvoiceService.deleteSalesInvoice({
      ...getRequestContext(req),
      invoiceNumber: getInvoiceNumber(req),
    });

    return res.status(200).json({
      success: true,
      message: "Sales invoice draft deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSalesInvoice,
  getSalesInvoices,
  getSalesInvoiceByNumber,
  updateSalesInvoice,
  postSalesInvoice,
  deleteSalesInvoice,
};
