const express = require("express");

const requirePermission = require("../../../middleware/permissionMiddleware");

const {
  validateSalesInvoiceParams,
} = require("../salesInvoice.validation");

const controller = require("./ewayBill.controller");
const validation = require("./ewayBill.validation");

/*
 * Mount inside salesInvoice.routes.js AFTER router.use(verifyToken,
 * resolveTenant), for example:
 *
 *   router.use("/number/:invoiceNumber/eway-bill", ewayBillRoutes);
 *
 * mergeParams is required so :invoiceNumber reaches the validators.
 *
 * Adjust the middleware require path above to match your folder depth.
 */
const router = express.Router({ mergeParams: true });

const manage = requirePermission("salesInvoice.ewayBill");

router.put(
  "/",
  manage,
  validateSalesInvoiceParams,
  validation.validateSaveEwayBillDetails,
  controller.saveDetails,
);

router.get(
  "/export",
  requirePermission("salesInvoice.view"),
  manage,
  validateSalesInvoiceParams,
  controller.exportPortalJson,
);

router.post(
  "/record",
  manage,
  validateSalesInvoiceParams,
  validation.validateRecordEwayBill,
  controller.recordGenerated,
);

router.post(
  "/vehicle",
  manage,
  validateSalesInvoiceParams,
  validation.validateUpdateEwayBillVehicle,
  controller.updateVehicle,
);

router.post(
  "/extend",
  manage,
  validateSalesInvoiceParams,
  validation.validateExtendEwayBill,
  controller.extendValidity,
);

router.post(
  "/cancel",
  manage,
  validateSalesInvoiceParams,
  validation.validateCancelEwayBill,
  controller.cancelEwayBill,
);

module.exports = router;
