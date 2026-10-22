const service = require("./taxRate.service");

const { importTaxRates } = require("./taxRate.import");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  taxRateId: req.validatedParams?.taxRateId,
  payload: req.validatedBody,
});

const createTaxRate = async (req, res, next) => {
  try {
    const data = await service.createTaxRate(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Tax rate created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listTaxRates = async (req, res, next) => {
  try {
    const result = await service.listTaxRates({
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

const getTaxRate = async (req, res, next) => {
  try {
    const data = await service.getTaxRate(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateTaxRate = async (req, res, next) => {
  try {
    const data = await service.updateTaxRate(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Tax rate updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const importRates = async (req, res, next) => {
  try {
    const result = await importTaxRates({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file?.buffer,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Tax rates imported successfully",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createTaxRate,
  listTaxRates,
  getTaxRate,
  updateTaxRate,
  importRates,
};
