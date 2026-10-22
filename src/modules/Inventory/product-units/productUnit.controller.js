const service = require("./productUnit.service");
const { importProductUnits } = require("./productUnit.import");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  unitCode: req.validatedParams?.unitCode,
  payload: req.validatedBody,
});

const createUnit = async (req, res, next) => {
  try {
    const data = await service.createUnit(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Product unit created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listUnits = async (req, res, next) => {
  try {
    const result = await service.listUnits({
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

const getUnit = async (req, res, next) => {
  try {
    const data = await service.getUnit(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateUnit = async (req, res, next) => {
  try {
    const data = await service.updateUnit(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Product unit updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const importUnits = async (req, res, next) => {
  try {
    const result = await importProductUnits({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file?.buffer,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Product units imported successfully",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};
module.exports = {
  createUnit,
  listUnits,
  getUnit,
  updateUnit,
  importUnits,
};
