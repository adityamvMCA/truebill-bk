const profitService = require("./salesInvoiceProfit.service");

const getBillProfitReport = async (req, res, next) => {
  try {
    const result = await profitService.getBillProfitReport({
      ...req.query,
      tenant: req.tenant,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const getBillProfitByNumber = async (req, res, next) => {
  try {
    const result = await profitService.getBillProfitByNumber({
      tenant: req.tenant,
      invoiceNumber: req.params.invoiceNumber,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getBillProfitReport, getBillProfitByNumber };
