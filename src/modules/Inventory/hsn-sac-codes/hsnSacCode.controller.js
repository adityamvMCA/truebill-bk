const service = require("./hsnSacCode.service");

const { importHsnSacCodes } = require("./hsnSacCode.import");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  code: req.validatedParams?.code,
  payload: req.validatedBody,
});

const createHsnSacCode = async (req, res, next) => {
  try {
    const data = await service.createHsnSacCode(getContext(req));

    return res.status(201).json({
      success: true,
      message: "HSN/SAC code created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listHsnSacCodes = async (req, res, next) => {
  try {
    const result = await service.listHsnSacCodes({
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

const getHsnSacCode = async (req, res, next) => {
  try {
    const data = await service.getHsnSacCode(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateHsnSacCode = async (req, res, next) => {
  try {
    const data = await service.updateHsnSacCode(getContext(req));

    return res.status(200).json({
      success: true,
      message: "HSN/SAC code updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const importCodes = async (req, res, next) => {
  try {
    const result = await importHsnSacCodes({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file?.buffer,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "HSN/SAC codes imported successfully",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createHsnSacCode,
  listHsnSacCodes,
  getHsnSacCode,
  updateHsnSacCode,
  importCodes,
};
