
const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const svc = require("./tds.service");

const inTransaction = (fn, message, status = 201) => {
  return async (req, res, next) => {
    let session;

    try {
      const connection = getReadyTenantConnection(req.tenant);
      session = await connection.startSession();

      let result;

      await session.withTransaction(async () => {
        result = await fn({
          tenant: req.tenant,
          connection,
          userId: req.user.userId,
          body: req.body,
          session,
        });
      });

      return res.status(status).json({
        success: true,
        message,
        data: result,
      });
    } catch (error) {
      return next(error);
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  };
};

const read = (fn) => {
  return async (req, res, next) => {
    try {
      const connection = getReadyTenantConnection(req.tenant);

      const result = await fn({
        tenant: req.tenant,
        connection,
        body: req.body,
        ...req.query,
      });

      if (Array.isArray(result)) {
        return res.status(200).json({
          success: true,
          data: result,
        });
      }

      return res.status(200).json({
        success: true,
        ...(result || {}),
      });
    } catch (error) {
      return next(error);
    }
  };
};

const preview = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);

    const result = await svc.previewTds({
      tenant: req.tenant,
      connection,
      body: req.body,
      ...req.query,
    });

    // Return one consistent response structure:
    // { success: true, data: { tdsPaise: ..., ratePercent: ... } }
    const previewData =
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      result.tdsPaise === undefined &&
      result.data &&
      typeof result.data === "object"
        ? result.data
        : result;

    if (
      !previewData ||
      typeof previewData !== "object" ||
      previewData.tdsPaise === undefined
    ) {
      return res.status(500).json({
        success: false,
        message:
          "TDS preview service did not return a valid calculation.",
      });
    }

    return res.status(200).json({
      success: true,
      data: previewData,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createNature: inTransaction(
    (args) => svc.createNature(args),
    "Nature of payment created",
  ),

  listNatures: read((args) => svc.listNatures(args)),

  preview,

  deduct: inTransaction(
    (args) => svc.deductTds(args),
    "TDS deducted",
  ),

  payChallan: inTransaction(
    (args) => svc.payChallan(args),
    "TDS deposit recorded",
  ),

  register: read((args) => svc.getRegister(args)),
};
