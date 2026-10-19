// src/modules/accounting/reports/outstanding.controller.js

const { getReadyTenantConnection } = require("../../../tenancy/tenantConnectionManager");
const { getCustomerOutstanding, getSupplierOutstanding } = require("./outstanding.service");

const getCustomerOutstandingHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await getCustomerOutstanding({ tenant: req.tenant, connection, query: req.query });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

const getSupplierOutstandingHandler = async (req, res, next) => {
  try {
    const connection = getReadyTenantConnection(req.tenant);
    const result = await getSupplierOutstanding({ tenant: req.tenant, connection, query: req.query });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
};

module.exports = { getCustomerOutstandingHandler, getSupplierOutstandingHandler };
