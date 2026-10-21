const service = require("./goodsReceipt.service");

const createReceipt = async (req, res, next) => {
  try {
    const result = await service.createReceipt({
      tenant: req.tenant,
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: req.validatedBody,
    });

    return res.status(result.replayed ? 200 : 201).json({
      success: true,

      message: result.replayed
        ? "Previously created Goods Receipt returned"
        : "Goods Receipt created successfully",

      replayed: result.replayed,
      data: result.receipt,
    });
  } catch (error) {
    return next(error);
  }
};

const listReceipts = async (req, res, next) => {
  try {
    const result = await service.listReceipts({
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

const getReceipt = async (req, res, next) => {
  try {
    const data = await service.getReceipt({
      tenant: req.tenant,
      receiptNumber: req.validatedParams.receiptNumber,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createReceipt,
  listReceipts,
  getReceipt,
};
