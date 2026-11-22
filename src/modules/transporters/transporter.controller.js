const transporterService = require("./transporter.service");

const ctx = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

exports.createTransporter = async (req, res, next) => {
  try {
    const transporter = await transporterService.createTransporter({
      ...ctx(req),
      payload: req.body,
    });

    res.status(201).json({
      success: true,
      message: "Transporter saved successfully",
      transporter,
    });
  } catch (e) {
    next(e);
  }
};

exports.getTransporters = async (req, res, next) => {
  try {
    const result = await transporterService.getTransporters({
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

exports.getTransporterById = async (req, res, next) => {
  try {
    const transporter = await transporterService.getTransporterById({
      tenant: req.tenant,
      id: req.validatedParams.id,
    });

    res.status(200).json({
      success: true,
      transporter,
    });
  } catch (e) {
    next(e);
  }
};

exports.updateTransporter = async (req, res, next) => {
  try {
    const transporter = await transporterService.updateTransporter({
      ...ctx(req),
      id: req.validatedParams.id,
      payload: req.body,
    });

    res.status(200).json({
      success: true,
      message: "Transporter updated successfully",
      transporter,
    });
  } catch (e) {
    next(e);
  }
};

exports.deleteTransporter = async (req, res, next) => {
  try {
    const result = await transporterService.deleteTransporter({
      ...ctx(req),
      id: req.validatedParams.id,
    });

    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
};
