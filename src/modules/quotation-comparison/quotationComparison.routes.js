const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");

const resolveTenant = require("../../middleware/tenantMiddleware");

const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./quotationComparison.controller");

const validation = require("./quotationComparison.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const requireRfqView = requirePermission("purchaseRfq.view");

const requireSourcePermission = (req, res, next) => {
  if (req.validatedBody.comparisonMode === "RFQ") {
    return requireRfqView(req, res, next);
  }

  return next();
};

router.post(
  "/preview",
  requirePermission("quotationComparison.view"),
  requirePermission("supplierQuotation.view"),
  validation.validateCompare,
  requireSourcePermission,
  controller.compareQuotations,
);

module.exports = router;
