const { getReadyTenantConnection } = require("../../../tenancy/tenantConnectionManager");
const svc = require("./tds.service");

const inTransaction = (fn, message, status = 201) => async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const session = await connection.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        result = await fn({ tenant: req.tenant, connection, userId: req.user.userId, body: req.body, session });
      });
      return res.status(status).json({ success: true, message, data: result });
    } finally {
      await session.endSession();
    }
  } catch (e) {
    return next(e);
  }
};

const read = (fn) => async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await fn({ tenant: req.tenant, connection, body: req.body, ...req.query });
    return res.status(200).json({ success: true, ...(Array.isArray(result) ? { data: result } : result) });
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  createNature: inTransaction(async (a) => svc.createNature(a), "Nature of payment created"),
  listNatures: read(svc.listNatures),
  preview: read(async (a) => ({ data: await svc.previewTds(a) })),
  deduct: inTransaction(svc.deductTds, "TDS deducted"),
  payChallan: inTransaction(svc.payChallan, "TDS deposit recorded"),
  register: read(svc.getRegister),
};
