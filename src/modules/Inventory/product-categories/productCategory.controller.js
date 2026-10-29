const service = require("./productCategory.service");
const { importProductCategories } = require("./productCategory.import");
const context = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  categoryCode: req.validatedParams?.categoryCode,
  payload: req.validatedBody,
});
const write =
  (method, message, status = 200) =>
  async (req, res, next) => {
    try {
      const data = await service[method](context(req));
      return res.status(status).json({ success: true, message, data });
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
    return res.json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};
const getCategory = async (req, res, next) => {
  try {
    return res.json({
      success: true,
      data: await service.getCategory(context(req)),
    });
  } catch (error) {
    return next(error);
  }
};
const importCategories = async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "CSV file is required",
      });
    }

    const result = await importProductCategories({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file.buffer,
      ipAddress: req.ip,
    });

    const successCount = result.successCount ?? 0;
    const failureCount = result.failureCount ?? 0;

    return res.status(successCount > 0 ? 200 : 400).json({
      success: successCount > 0,
      message:
        successCount > 0
          ? `Imported ${successCount} category(s) successfully`
          : "No categories were imported",
      totalRows: result.totalRows ?? 0,
      createdCount: successCount,
      failedCount: failureCount,
      errors: result.errors ?? [],
    });
  } catch (error) {
    return next(error);
  }
};
const seedDefaults = async (req, res, next) => {
  try {
    const data = await service.seedDefaults({
      ...context(req),
      confirm: req.validatedBody.confirm,
    });
    return res.json({
      success: true,
      message: "Tenant defaults seeded without overwriting existing values",
      data,
    });
  } catch (error) {
    return next(error);
  }
};
const bulkUpdateStatus = async (req, res, next) => {
  try {
    const result = await service.bulkUpdateStatus({
      tenant: req.tenant,
      userId: req.user.userId,
      categoryCodes: req.body?.categoryCodes,
      status: req.body?.status,
    });

    return res.json({
      success: true,
      message: "Categories updated successfully",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};
module.exports = {
  createCategory: write(
    "createCategory",
    "Product category created successfully",
    201,
  ),
  updateCategory: write(
    "updateCategory",
    "Product category updated successfully",
  ),
  listCategories,
  getCategory,
  importCategories,
  seedDefaults,
  bulkUpdateStatus
};
