const taxConfigurationService = require("./taxConfiguration.service");

const getTaxConfiguration = async (req, res, next) => {
  try {
    const result = await taxConfigurationService.getTaxConfiguration({
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      configuration: result.configuration,
      ledgers: result.ledgers,
    });
  } catch (error) {
    return next(error);
  }
};

const saveTaxConfiguration = async (req, res, next) => {
  try {
    const configuration = await taxConfigurationService.saveTaxConfiguration({
      tenant: req.tenant,
      userId: req.user.userId,
      ipAddress: req.ip,
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Tax configuration saved successfully",
      configuration,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getTaxConfiguration,
  saveTaxConfiguration,
};
