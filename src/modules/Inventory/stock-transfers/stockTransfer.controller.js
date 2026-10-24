const service = require("./stockTransfer.service");
const context = (req) => ({ tenant: req.tenant, userId: req.user.userId, ipAddress: req.ip, payload: req.validatedBody });
const createTransfer = async (req, res, next) => {
  try {
    const data = await service.createTransfer(context(req));
    return res.status(data.replayed ? 200 : 201).json({ success: true, message: data.replayed ? "Existing transfer returned; stock was not moved again" : "Stock transferred successfully", data });
  } catch (error) { return next(error); }
};
const listTransfers = async (req, res, next) => {
  try {
    const result = await service.listTransfers({ ...req.validatedQuery, tenant: req.tenant });
    return res.json({ success: true, ...result });
  } catch (error) { return next(error); }
};
const getTransfer = async (req, res, next) => {
  try {
    const data = await service.getTransfer({ tenant: req.tenant, transferNumber: req.validatedParams.transferNumber });
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
};
const enableMultiWarehouse = async (req, res, next) => {
  try {
    const data = await service.enableMultiWarehouse({ ...context(req), confirm: req.validatedBody.confirm });
    return res.json({ success: true, message: data.alreadyEnabled ? "Multi-warehouse mode is already enabled" : "Multi-warehouse mode enabled", data });
  } catch (error) { return next(error); }
};
module.exports = { createTransfer, listTransfers, getTransfer, enableMultiWarehouse };
