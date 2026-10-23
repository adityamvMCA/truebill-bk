const service = require("./productCategory.service");
const { importProductCategories } = require("./productCategory.import");
const context = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  categoryCode: req.validatedParams?.categoryCode,
  payload: req.validatedBody,
});
const write = (method, message, status = 200) => async (req, res, next) => {
  try {
    const data = await service[method](context(req));
    return res.status(status).json({ success: true, message, data });
  } catch (error) { return next(error); }
};
const listCategories = async (req, res, next) => {
  try {
    const result = await service.listCategories({ ...req.validatedQuery, tenant: req.tenant });
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
};
const getCategory = async (req, res, next) => {
  try { return res.json({ success: true, data: await service.getCategory(context(req)) }); }
  catch (error) { return next(error); }
};
const importCategories = async (req, res, next) => {
  try {
    const result = await importProductCategories({ ...context(req), buffer: req.file?.buffer });
    return res.json({
      success: !result.requiresVerification,
      message: result.message || "Import completed; check row results",
      ...result,
    });
  } catch (error) { return next(error); }
};
const seedDefaults = async (req, res, next) => {
  try {
    const data = await service.seedDefaults({ ...context(req), confirm: req.validatedBody.confirm });
    return res.json({ success: true, message: "Tenant defaults seeded without overwriting existing values", data });
  } catch (error) { return next(error); }
};
module.exports = {
  createCategory: write("createCategory", "Product category created successfully", 201),
  updateCategory: write("updateCategory", "Product category updated successfully"),
  listCategories, getCategory, importCategories, seedDefaults,
};
