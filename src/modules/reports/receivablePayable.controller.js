const Joi = require("joi");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getReport, getPartyDocuments } = require("./receivablePayable.service");

const querySchema = Joi.object({
  asOfDate: Joi.date().iso(),
  overdueOnly: Joi.boolean().default(false),
}).unknown(false);

const parseQuery = (query) => {
  const { error, value } = querySchema.validate(query, { convert: true });

  if (error) {
    const err = new Error(error.details[0].message);
    err.statusCode = 400;
    throw err;
  }

  return value;
};

const handler = (kind, detail) => async (req, res, next) => {
  try {
    const query = parseQuery(req.query);
    const connection = getReadyTenantConnection(req.tenant);

    const result = detail
      ? await getPartyDocuments({
          tenant: req.tenant,
          connection,
          kind,
          partyId: req.params.partyId,
          asOfDate: query.asOfDate,
        })
      : await getReport({
          tenant: req.tenant,
          connection,
          kind,
          asOfDate: query.asOfDate,
          overdueOnly: query.overdueOnly,
        });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getPayables: handler("PAYABLE", false),
  getPayableParty: handler("PAYABLE", true),
  getReceivables: handler("RECEIVABLE", false),
  getReceivableParty: handler("RECEIVABLE", true),
};
