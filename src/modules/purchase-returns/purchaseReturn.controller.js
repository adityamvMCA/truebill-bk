const service = require("./purchaseReturn.service");

const createReturn = async (req, res, next) => {
  try {
    const result = await service.createReturn({
      tenant: req.tenant,
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: req.validatedBody,
    });

    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed
        ? "This Purchase Return was already recorded"
        : "Purchase Return created and posted successfully",
      replayed: result.replayed,
      data: result.purchaseReturn,
    });
  } catch (error) {
    return next(error);
  }
};

const listReturns = async (req, res, next) => {
  try {
    const result = await service.listReturns({
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

const getReturn = async (req, res, next) => {
  try {
    const data = await service.getReturn({
      tenant: req.tenant,
      returnNumber: req.validatedParams.returnNumber,
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
  createReturn,
  listReturns,
  getReturn,
};
