const purchaseBillService = require("./purchaseBill.service");

const getRequestContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getBillNumber = (req) =>
  req.validatedParams?.billNumber || req.params.billNumber;

const createPurchaseBill = async (req, res, next) => {
  try {
    const bill = await purchaseBillService.createPurchaseBill({
      ...getRequestContext(req),
      payload: req.body,
    });

    return res.status(201).json({
      success: true,
      message:
        bill.status === "POSTED"
          ? "Purchase bill created and posted successfully"
          : "Purchase bill draft created successfully",
      bill,
    });
  } catch (error) {
    return next(error);
  }
};

const getPurchaseBills = async (req, res, next) => {
  try {
    const result = await purchaseBillService.getPurchaseBills({
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

const getPurchaseBillByNumber = async (req, res, next) => {
  try {
    const bill = await purchaseBillService.getPurchaseBillByNumber({
      tenant: req.tenant,
      billNumber: getBillNumber(req),
    });

    return res.status(200).json({
      success: true,
      bill,
    });
  } catch (error) {
    return next(error);
  }
};

const updatePurchaseBill = async (req, res, next) => {
  try {
    const bill = await purchaseBillService.updatePurchaseBill({
      ...getRequestContext(req),
      billNumber: getBillNumber(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Purchase bill draft updated successfully",
      bill,
    });
  } catch (error) {
    return next(error);
  }
};

const postPurchaseBill = async (req, res, next) => {
  try {
    const bill = await purchaseBillService.postPurchaseBill({
      ...getRequestContext(req),
      billNumber: getBillNumber(req),
    });

    return res.status(200).json({
      success: true,
      message: "Purchase bill posted successfully",
      bill,
    });
  } catch (error) {
    return next(error);
  }
};

const deletePurchaseBill = async (req, res, next) => {
  try {
    await purchaseBillService.deletePurchaseBill({
      ...getRequestContext(req),
      billNumber: getBillNumber(req),
    });

    return res.status(200).json({
      success: true,
      message: "Purchase bill draft deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const getPurchaseBillPayments = async (req, res, next) => {
  try {
    const result = await purchaseBillService.getPurchaseBillPayments({
      ...req.validatedQuery,
      tenant: req.tenant,
      billNumber: req.validatedParams?.billNumber || req.params.billNumber,
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

module.exports = {
  createPurchaseBill,
  getPurchaseBills,
  getPurchaseBillByNumber,
  updatePurchaseBill,
  postPurchaseBill,
  deletePurchaseBill,
  getPurchaseBillPayments,
};
