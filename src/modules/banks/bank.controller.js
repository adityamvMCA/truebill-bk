const bankService = require("./bank.service");

const ctx = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

exports.createBank = async (req, res, next) => {
  try {
    const bank = await bankService.createBank({
      ...ctx(req),
      payload: req.body,
    });

    res.status(201).json({
      success: true,
      message: "Bank account created successfully",
      bank,
    });
  } catch (e) {
    next(e);
  }
};

exports.getBanks = async (req, res, next) => {
  try {
    const result = await bankService.getBanks({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (e) {
    next(e);
  }
};

exports.getBankByCode = async (req, res, next) => {
  try {
    const bank = await bankService.getBankByCode({
      tenant: req.tenant,
      bankCode: req.validatedParams.bankCode,
    });

    res.status(200).json({
      success: true,
      bank,
    });
  } catch (e) {
    next(e);
  }
};

exports.updateBank = async (req, res, next) => {
  try {
    const bank = await bankService.updateBank({
      ...ctx(req),
      bankCode: req.validatedParams.bankCode,
      payload: req.body,
    });

    res.status(200).json({
      success: true,
      message: "Bank account updated successfully",
      bank,
    });
  } catch (e) {
    next(e);
  }
};