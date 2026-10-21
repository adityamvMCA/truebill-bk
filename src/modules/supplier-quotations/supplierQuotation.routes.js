const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./supplierQuotation.controller");
const validation = require("./supplierQuotation.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

const requireDirectCreate = requirePermission("supplierQuotation.createDirect");

const requireRfqView = requirePermission("purchaseRfq.view");

const requireCreationModePermission = (req, res, next) => {
  if (req.validatedBody.creationMode === "DIRECT") {
    return requireDirectCreate(req, res, next);
  }

  return requireRfqView(req, res, next);
};

router.get(
  "/",
  requirePermission("supplierQuotation.view"),
  validation.validateList,
  controller.listQuotations,
);

router.post(
  "/",
  requirePermission("supplierQuotation.create"),
  validation.validateCreate,
  requireCreationModePermission,
  controller.createQuotation,
);

router.get(
  "/:quotationNumber",
  requirePermission("supplierQuotation.view"),
  validation.validateParams,
  controller.getQuotation,
);

router.patch(
  "/:quotationNumber",
  requirePermission("supplierQuotation.update"),
  validation.validateParams,
  validation.validateUpdate,
  controller.updateQuotation,
);

router.post(
  "/:quotationNumber/cancel",
  requirePermission("supplierQuotation.cancel"),
  validation.validateParams,
  validation.validateCancel,
  controller.cancelQuotation,
);

const deletePermission = requirePermission(
  "supplierQuotation.delete",
);

const deleteHandlers = {
  deletePermission,
  validateParams: validation.validateParams,
  validateVersion: validation.validateVersion,
  deleteQuotation: controller.deleteQuotation,
};

for (const [name, handler] of Object.entries(deleteHandlers)) {
  if (typeof handler !== "function") {
    throw new TypeError(
      `[SupplierQuotation DELETE] ${name} must be a function; received ${typeof handler}`,
    );
  }
}

router.delete(
  "/:quotationNumber",
  deletePermission,
  validation.validateParams,
  validation.validateVersion,
  controller.deleteQuotation,
);

module.exports = router;
