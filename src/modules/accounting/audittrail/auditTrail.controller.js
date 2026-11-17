const auditTrailService = require("./auditTrail.service");

const getAuditTrail = async (req, res, next) => {
  try {
    const result = await auditTrailService.getAuditTrail({
      ...req.query,
      tenant: req.tenant,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const getAuditDocuments = async (req, res, next) => {
  try {
    const result = await auditTrailService.getAuditDocuments({
      ...req.query,
      tenant: req.tenant,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const getAuditEntry = async (req, res, next) => {
  try {
    const result = await auditTrailService.getAuditEntry({
      tenant: req.tenant,
      id: req.params.id,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getAuditTrail, getAuditDocuments, getAuditEntry };
