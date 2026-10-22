const service = require("./warehouseStock.service");

const listWarehouseStock = async (req, res, next) => {
  try {
    const result = await service.listWarehouseStock({
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

const getProductWarehouseStock = async (req, res, next) => {
  try {
    const result = await service.getProductWarehouseStock({
      ...req.validatedQuery,

      tenant: req.tenant,

      productCode: req.validatedParams.productCode,
    });

    return res.status(200).json({
      success: true,
      product: result.product,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listWarehouseStock,
  getProductWarehouseStock,
};
