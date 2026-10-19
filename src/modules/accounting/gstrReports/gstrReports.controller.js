const gstrReportsService = require("./gstrReports.service");

const getGstr1 = async (req, res, next) => {
  try {
    const result = await gstrReportsService.getGstr1({
      tenant: req.tenant,
      ...req.query,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const getGstr3b = async (req, res, next) => {
  try {
    const result = await gstrReportsService.getGstr3b({
      tenant: req.tenant,
      ...req.query,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getGstr1, getGstr3b };
