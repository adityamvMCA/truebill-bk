const service = require("./productCategory.service");
const { importProductCategories } = require("./productCategory.import");

const importCategories = async (req, res, next) => {
  try {
    const result = await importProductCategories({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file?.buffer,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Product categories imported successfully",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};
const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  categoryCode: req.validatedParams?.categoryCode,
  payload: req.validatedBody,
});

const createCategory = async (req, res, next) => {
  try {
    const data = await service.createCategory(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Product category created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listCategories = async (req, res, next) => {
  try {
    const result = await service.listCategories({
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

const getCategory = async (req, res, next) => {
  try {
    const data = await service.getCategory(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const data = await service.updateCategory(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Product category updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createCategory,
  listCategories,
  getCategory,
  updateCategory,
  importCategories
};
