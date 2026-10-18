const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const { createFromSalesOrder } = require("./salesInvoiceFromOrder.controller");
const {
  validateInvoiceOrderParams,
  validateInvoiceOrderBody,
} = require("./salesInvoiceFromOrder.validation");
const {
  createSalesInvoice,
  getSalesInvoices,
  getSalesInvoiceByNumber,
  updateSalesInvoice,
  postSalesInvoice,
  deleteSalesInvoice,
} = require("./salesInvoice.controller");

const {
  validateCreateSalesInvoice,
  validateUpdateSalesInvoice,
  validatePostSalesInvoice,
  validateSalesInvoiceParams,
  validateListSalesInvoices,
} = require("./salesInvoice.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const checkPostPermission = requirePermission("salesInvoice.post");

const requirePostPermissionForCreate = (req, res, next) => {
  if (req.body.action === "SAVE_AND_POST") {
    return checkPostPermission(req, res, next);
  }

  return next();
};

router.get(
  "/",
  requirePermission("salesInvoice.view"),
  validateListSalesInvoices,
  getSalesInvoices,
);

router.post(
  "/",
  requirePermission("salesInvoice.create"),
  validateCreateSalesInvoice,
  requirePostPermissionForCreate,
  createSalesInvoice,
);

router.get(
  "/number/:invoiceNumber",
  requirePermission("salesInvoice.view"),
  validateSalesInvoiceParams,
  getSalesInvoiceByNumber,
);

router.put(
  "/number/:invoiceNumber",
  requirePermission("salesInvoice.update"),
  validateSalesInvoiceParams,
  validateUpdateSalesInvoice,
  updateSalesInvoice,
);

router.post(
  "/number/:invoiceNumber/post",
  requirePermission("salesInvoice.post"),
  validateSalesInvoiceParams,
  validatePostSalesInvoice,
  postSalesInvoice,
);

router.delete(
  "/number/:invoiceNumber",
  requirePermission("salesInvoice.delete"),
  validateSalesInvoiceParams,
  deleteSalesInvoice,
);
router.post(
  "/from-sales-order/:orderNumber",

  requirePermission("salesInvoice.create"),
  requirePermission("salesOrder.view"),
  validateInvoiceOrderParams,
  validateInvoiceOrderBody,
  createFromSalesOrder,
);

module.exports = router;
