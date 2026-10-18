const salesQuotationService = require("./salesQuotation.service");

const getRequestContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const getQuotationId = (req) => req.validatedParams?.id ?? req.params.id;

const createQuotation = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.createQuotation({
      ...getRequestContext(req),
      payload: req.body,
    });

    return res.status(201).json({
      success: true,
      message: "Sales quotation draft created successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const getQuotations = async (req, res, next) => {
  try {
    const result = await salesQuotationService.getQuotations({
      tenant: req.tenant,
      query: req.validatedQuery,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getQuotationById = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.getQuotationById({
      tenant: req.tenant,
      quotationId: getQuotationId(req),
    });

    return res.status(200).json({
      success: true,
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const updateDraftQuotation = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.updateDraftQuotation({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales quotation draft updated successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const issueQuotation = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.issueQuotation({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales quotation issued successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const createRevision = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.createRevision({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(201).json({
      success: true,
      message: "Sales quotation revision created successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const acceptQuotation = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.acceptQuotation({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales quotation accepted successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const rejectQuotation = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.rejectQuotation({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales quotation rejected successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const cancelQuotation = async (req, res, next) => {
  try {
    const quotation = await salesQuotationService.cancelQuotation({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales quotation cancelled successfully",
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteDraftQuotation = async (req, res, next) => {
  try {
    await salesQuotationService.deleteDraftQuotation({
      ...getRequestContext(req),
      quotationId: getQuotationId(req),
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: "Sales quotation draft deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
};

const compareQuotations = async (req, res, next) => {
  try {
    const result = await salesQuotationService.compareQuotations({
      tenant: req.tenant,
      comparisonGroupId: req.validatedQuery.comparisonGroupId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};
const getQuotationByNumber = async (req, res, next) => {
  try {
    const quotation =
      await salesQuotationService.getQuotationByNumber({
        tenant: req.tenant,
        quotationNumber: req.params.quotationNumber,
        revision: req.params.revision,
      });

    return res.status(200).json({
      success: true,
      data: quotation,
    });
  } catch (error) {
    return next(error);
  }
};
module.exports = {
  createQuotation,
  getQuotations,
  getQuotationById,
  updateDraftQuotation,
  issueQuotation,
  createRevision,
  acceptQuotation,
  rejectQuotation,
  cancelQuotation,
  deleteDraftQuotation,
  compareQuotations,
  getQuotationByNumber
};
