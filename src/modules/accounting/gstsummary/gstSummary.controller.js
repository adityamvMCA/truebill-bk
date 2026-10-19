const gstSummaryService = require("./gstSummary.service");

const getGstSummary = async (req, res, next) => {
  try {
    const result = await gstSummaryService.getGstSummary({
      tenant: req.tenant,
      ...req.query,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getGstSummary };