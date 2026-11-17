const reportService = require("./product.report.service");

const handler = (serviceFn) => async (req, res, next) => {
  try {
    const result = await serviceFn({
      tenant: req.tenant,
      productCode: req.params.productCode,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getStockDetails: handler(reportService.getStockDetails),
  getPartyWiseReport: handler(reportService.getPartyWiseReport),
  getGodownReport: handler(reportService.getGodownReport),
  getPartyPrices: handler(reportService.getPartyPrices),
};

/* ------------------------------------------------------------------ */
/* ADD THESE TO product.routes.js (before `module.exports = router`)   */
/* ------------------------------------------------------------------ */
/*

const reportController = require("./product.report.controller");

router.get(
  "/code/:productCode/reports/stock",
  requirePermission("product.view"),
  reportController.getStockDetails,
);

router.get(
  "/code/:productCode/reports/party-wise",
  requirePermission("product.view"),
  reportController.getPartyWiseReport,
);

router.get(
  "/code/:productCode/reports/godown",
  requirePermission("product.view"),
  reportController.getGodownReport,
);

router.get(
  "/code/:productCode/reports/party-prices",
  requirePermission("product.view"),
  reportController.getPartyPrices,
);

*/
