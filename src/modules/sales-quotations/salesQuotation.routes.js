const express = require("express");

const salesQuotationController = require(
  "./salesQuotation.controller",
);

const salesQuotationValidation = require(
  "./salesQuotation.validation",
);

const verifyToken = require(
  "../../middleware/authMiddleware",
);

const resolveTenant = require(
  "../../middleware/tenantMiddleware",
);

const requirePermission = require(
  "../../middleware/permissionMiddleware",
);

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("salesQuotation.view"),
  salesQuotationValidation.validateListQuotations,
  salesQuotationController.getQuotations,
);

// Must precede /:id so "compare"
// is not interpreted as a quotation ID.
router.get(
  "/compare",
  requirePermission("salesQuotation.view"),
  salesQuotationValidation.validateCompareQuotations,
  salesQuotationController.compareQuotations,
);

router.get(
  "/:id",
  requirePermission("salesQuotation.view"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationController.getQuotationById,
);

router.post(
  "/",
  requirePermission("salesQuotation.create"),
  salesQuotationValidation.validateCreateQuotation,
  salesQuotationController.createQuotation,
);

router.patch(
  "/:id",
  requirePermission("salesQuotation.update"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateUpdateDraftQuotation,
  salesQuotationController.updateDraftQuotation,
);

router.post(
  "/:id/issue",
  requirePermission("salesQuotation.issue"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateIssueQuotation,
  salesQuotationController.issueQuotation,
);

router.post(
  "/:id/revisions",
  requirePermission("salesQuotation.create"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateCreateRevision,
  salesQuotationController.createRevision,
);

router.post(
  "/:id/accept",
  requirePermission("salesQuotation.update"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateAcceptQuotation,
  salesQuotationController.acceptQuotation,
);

router.post(
  "/:id/reject",
  requirePermission("salesQuotation.update"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateRejectQuotation,
  salesQuotationController.rejectQuotation,
);

router.post(
  "/:id/cancel",
  requirePermission("salesQuotation.delete"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateCancelQuotation,
  salesQuotationController.cancelQuotation,
);

router.delete(
  "/:id",
  requirePermission("salesQuotation.delete"),
  salesQuotationValidation.validateQuotationIdParam,
  salesQuotationValidation.validateDeleteDraftQuotation,
  salesQuotationController.deleteDraftQuotation,
);
router.get(
  "/by-number/:quotationNumber/:revision",
  requirePermission("salesQuotation.view"),
  salesQuotationController.getQuotationByNumber,
);
module.exports = router;