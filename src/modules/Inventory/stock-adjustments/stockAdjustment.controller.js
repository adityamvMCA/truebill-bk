const service = require("./stockAdjustment.service");

const createStockAdjustment = async (req, res, next) => {
  try {
    const adjustment = await service.createStockAdjustment({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.validatedBody,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Stock adjustment created successfully",
      data: adjustment,
    });
  } catch (error) {
    return next(error);
  }
};

const listStockAdjustments = async (req, res, next) => {
  try {
    const result = await service.listStockAdjustments({
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

const getStockAdjustment = async (req, res, next) => {
  try {
    const adjustment = await service.getStockAdjustment({
      tenant: req.tenant,
      adjustmentNumber: req.params.adjustmentNumber,
    });

    return res.status(200).json({
      success: true,
      data: adjustment,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createStockAdjustment,
  listStockAdjustments,
  getStockAdjustment,
};
