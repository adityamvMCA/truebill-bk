const service = require("./warehouse.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  warehouseCode: req.validatedParams?.warehouseCode,
  payload: req.validatedBody,
});

const createWarehouse = async (req, res, next) => {
  try {
    const data = await service.createWarehouse(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Warehouse created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listWarehouses = async (req, res, next) => {
  try {
    const result = await service.listWarehouses({
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

const getWarehouse = async (req, res, next) => {
  try {
    const data = await service.getWarehouse(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateWarehouse = async (req, res, next) => {
  try {
    const data = await service.updateWarehouse(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Warehouse updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const getInventorySettings = async (req, res, next) => {
  try {
    const data = await service.getInventorySettings({
      tenant: req.tenant,
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
  createWarehouse,
  listWarehouses,
  getWarehouse,
  updateWarehouse,
  getInventorySettings,
};
