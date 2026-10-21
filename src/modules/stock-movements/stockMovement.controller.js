const stockMovementService = require("./stockMovement.service");

const getStockMovements = async (req, res, next) => {
  try {
    const result = await stockMovementService.getStockMovements({
      tenant: req.tenant,
      productCode: req.query.productCode,
      movementType: req.query.movementType,
      direction: req.query.direction,
      page: req.query.page,
      limit: req.query.limit,
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

const createManualAdjustment = async (req, res, next) => {
  try {
    const result = await stockMovementService.createManualAdjustment({
      tenant: req.tenant,
      userId: req.user.userId,
      productCode: req.params.productCode,
      adjustmentType: req.body.adjustmentType,
      quantity: req.body.quantity,
      unitRate: req.body.unitRate,
      notes: req.body.notes,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Stock adjustment created successfully",
      product: result.product,
      movement: result.movement,
    });
  } catch (error) {
    return next(error);
  }
};

const backfillOpeningStock = async (req, res, next) => {
  try {
    const result = await stockMovementService.backfillOpeningStock({
      tenant: req.tenant,
      userId: req.user.userId,
      productCode: req.params.productCode,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Opening stock movement created successfully",
      product: result.product,
      movement: result.movement,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getStockMovements,
  createManualAdjustment,
  backfillOpeningStock,
};
