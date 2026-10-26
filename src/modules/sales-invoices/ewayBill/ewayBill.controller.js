const service = require("./ewayBill.service");

const getRequestContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  invoiceNumber: req.validatedParams.invoiceNumber,
});

const respond = (message, run) => async (req, res, next) => {
  try {
    const invoice = await run({
      ...getRequestContext(req),
      payload: req.validatedBody,
    });

    return res.status(200).json({
      success: true,
      message,
      invoice,
    });
  } catch (error) {
    return next(error);
  }
};

const saveDetails = respond(
  "E-way bill details saved successfully",
  service.saveDetails,
);

const recordGenerated = respond(
  "E-way bill recorded successfully",
  service.recordGenerated,
);

const updateVehicle = respond(
  "Vehicle details updated successfully",
  service.updateVehicle,
);

const extendValidity = respond(
  "E-way bill validity extended successfully",
  service.extendValidity,
);

const cancelEwayBill = respond(
  "E-way bill cancelled successfully",
  service.cancelEwayBill,
);

const exportPortalJson = async (req, res, next) => {
  try {
    const { fileName, payload } = await service.exportPortalJson({
      tenant: req.tenant,
      invoiceNumber: req.validatedParams.invoiceNumber,
    });

    return res.status(200).json({
      success: true,
      fileName,
      payload,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  saveDetails,
  recordGenerated,
  updateVehicle,
  extendValidity,
  cancelEwayBill,
  exportPortalJson,
};
