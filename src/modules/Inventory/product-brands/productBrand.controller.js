const service = require("./productBrand.service");
const { importProductBrands } = require("./productBrand.import");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  brandId: req.validatedParams?.brandId,
  payload: req.validatedBody,
});

const importBrands = async (req, res, next) => {
  try {
    const result = await importProductBrands({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file?.buffer,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Product brands imported successfully",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};
const createBrand = async (req, res, next) => {
  try {
    const data = await service.createBrand(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Product brand created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listBrands = async (req, res, next) => {
  try {
    const result = await service.listBrands({
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

const getBrand = async (req, res, next) => {
  try {
    const data = await service.getBrand(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateBrand = async (req, res, next) => {
  try {
    const data = await service.updateBrand(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Product brand updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createBrand,
  listBrands,
  getBrand,
  updateBrand,
  importBrands
};
