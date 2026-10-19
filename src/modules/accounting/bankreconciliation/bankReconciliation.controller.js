const service = require("./bankReconciliation.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getBankAccounts = async (req, res, next) => {
  try {
    const accounts = await service.getBankAccounts({ tenant: req.tenant });

    return res.status(200).json({ success: true, data: accounts });
  } catch (error) {
    return next(error);
  }
};

const getBankReconciliation = async (req, res, next) => {
  try {
    const result = await service.getBankReconciliation({
      tenant: req.tenant,
      ...req.query,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const setCleared = async (req, res, next) => {
  try {
    const result = await service.setCleared({
      ...getContext(req),
      ...req.body,
    });

    return res.status(200).json({
      success: true,
      message: req.body?.clear
        ? "Transactions marked as cleared"
        : "Transactions marked as uncleared",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

const finalizeReconciliation = async (req, res, next) => {
  try {
    const reconciliation = await service.finalizeReconciliation({
      ...getContext(req),
      ...req.body,
    });

    return res.status(201).json({
      success: true,
      message: "Bank reconciliation completed successfully",
      reconciliation,
    });
  } catch (error) {
    return next(error);
  }
};

const undoReconciliation = async (req, res, next) => {
  try {
    const reconciliation = await service.undoReconciliation({
      ...getContext(req),
      reconciliationId: req.params.reconciliationId,
    });

    return res.status(200).json({
      success: true,
      message: "Bank reconciliation reversed successfully",
      reconciliation,
    });
  } catch (error) {
    return next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const result = await service.getHistory({
      tenant: req.tenant,
      ...req.query,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getBankAccounts,
  getBankReconciliation,
  setCleared,
  finalizeReconciliation,
  undoReconciliation,
  getHistory,
};
