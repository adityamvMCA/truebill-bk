const profitLossService = require("./profitLoss.service");

const getProfitLoss = async (req, res, next) => {
  try {
    const { data, rows } = await profitLossService.getProfitLoss({
      tenant: req.tenant,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      compare: req.query.compare,
    });

    return res.status(200).json({ success: true, data, rows });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getProfitLoss };
