const express = require("express");

const verifyToken = require(
  "../../middleware/authMiddleware",
);

const resolveTenant = require(
  "../../middleware/tenantMiddleware",
);

const requirePermission = require(
  "../../middleware/permissionMiddleware",
);

const controller = require(
  "./salesOrder.controller",
);

const validation = require(
  "./salesOrder.validation",
);

const router = express.Router();

router.use(verifyToken, resolveTenant);

const requireConfirmPermission =
  requirePermission("salesOrder.confirm");

const requireConfirmPermissionForCreate = (
  req,
  res,
  next,
) => {
  if (
    req.validatedBody.action === "CONFIRM"
  ) {
    return requireConfirmPermission(
      req,
      res,
      next,
    );
  }

  return next();
};

router.post(
  "/from-quotation/:quotationId",
  requirePermission("salesOrder.create"),
  validation.validateQuotationIdParams,
  validation.validateConvertQuotation,
  requireConfirmPermissionForCreate,
  controller.convertQuotationToSalesOrder,
);

router.get(
  "/",
  requirePermission("salesOrder.view"),
  validation.validateListSalesOrders,
  controller.getSalesOrders,
);

router.post(
  "/",
  requirePermission("salesOrder.create"),
  validation.validateCreateSalesOrder,
  requireConfirmPermissionForCreate,
  controller.createSalesOrder,
);

router.get(
  "/:orderNumber",
  requirePermission("salesOrder.view"),
  validation.validateSalesOrderParams,
  controller.getSalesOrderByNumber,
);

router.patch(
  "/:orderNumber",
  requirePermission("salesOrder.update"),
  validation.validateSalesOrderParams,
  validation.validateUpdateSalesOrder,
  controller.updateSalesOrder,
);

router.post(
  "/:orderNumber/confirm",
  requirePermission("salesOrder.confirm"),
  validation.validateSalesOrderStatusParams,
  validation.validateSalesOrderVersion,
  controller.confirmSalesOrder,
);

router.post(
  "/:orderNumber/start",
  requirePermission("salesOrder.start"),
  validation.validateSalesOrderStatusParams,
  validation.validateSalesOrderVersion,
  controller.startSalesOrder,
);

router.post(
  "/:orderNumber/complete",
  requirePermission("salesOrder.complete"),
  validation.validateSalesOrderStatusParams,
  validation.validateSalesOrderVersion,
  controller.completeSalesOrder,
);

router.post(
  "/:orderNumber/cancel",
  requirePermission("salesOrder.cancel"),
  validation.validateSalesOrderStatusParams,
  validation.validateCancelSalesOrder,
  controller.cancelSalesOrder,
);

// Remains compatible with your current list:
// DELETE does not yet require a request body.
router.delete(
  "/:orderNumber",
  requirePermission("salesOrder.delete"),
  validation.validateSalesOrderParams,
  controller.deleteSalesOrder,
);

module.exports = router;