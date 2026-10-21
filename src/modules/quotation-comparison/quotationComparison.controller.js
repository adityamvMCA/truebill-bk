const service = require("./quotationComparison.service");

const compareQuotations = async (req, res, next) => {
  try {
    const data = await service.compareQuotations({
      tenant: req.tenant,
      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message: "Quotation comparison generated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  compareQuotations,
};
