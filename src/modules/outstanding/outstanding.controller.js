const { getOutstanding, getOutstandingSummary } = require("./outstanding.service");

const listHandler = (kind) => async (req, res, next) => {
  try {
    const result = await getOutstanding({
      ...req.validatedQuery,
      tenant: req.tenant,
      kind,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
};

const summaryHandler = (kind) => async (req, res, next) => {
  try {
    // The summary ignores view / partyId / paging.
    const { view, partyId, page, limit, ...filters } = req.validatedQuery;

    const result = await getOutstandingSummary({
      ...filters,
      tenant: req.tenant,
      kind,
    });

    // `data` and `totals` both carry the numbers so the UI hook can read either.
    return res.status(200).json({ success: true, ...result, data: result.totals });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCustomerOutstanding: listHandler("customer"),
  getSupplierOutstanding: listHandler("supplier"),
  getCustomerOutstandingSummary: summaryHandler("customer"),
  getSupplierOutstandingSummary: summaryHandler("supplier"),
};