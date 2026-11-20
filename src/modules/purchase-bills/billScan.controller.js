const billScanService = require("./billScan.service");

const scanBill = async (req, res, next) => {
  try {
    const data = await billScanService.scanBill({
      tenant: req.tenant,
      files: req.files,
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
};

const confirmScan = async (req, res, next) => {
  try {
    const result = await billScanService.confirmScan({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Purchase bill created and posted successfully",
      bill: result.bill,
      created: result.created,
      warnings: result.warnings,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { scanBill, confirmScan };
