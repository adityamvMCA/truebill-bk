const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const controller = require("./salesReturn.controller");

const {
  validateCreateSalesReturn,
  validateUpdateSalesReturn,
  validateSalesReturnParams,
  validateListSalesReturns,
} = require("./salesReturn.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("salesReturn.view"),
  validateListSalesReturns,
  controller.getSalesReturns,
);

router.post(
  "/",
  requirePermission("salesReturn.create"),
  validateCreateSalesReturn,
  controller.createSalesReturn,
);

router.get(
  "/number/:returnNumber",
  requirePermission("salesReturn.view"),
  validateSalesReturnParams,
  controller.getSalesReturnByNumber,
);

router.put(
  "/number/:returnNumber",
  requirePermission("salesReturn.update"),
  validateSalesReturnParams,
  validateUpdateSalesReturn,
  controller.updateSalesReturn,
);

router.delete(
  "/number/:returnNumber",
  requirePermission("salesReturn.delete"),
  validateSalesReturnParams,
  controller.deleteSalesReturn,
);

router.post(
  "/number/:returnNumber/post",
  requirePermission("salesReturn.post"),
  validateSalesReturnParams,
  controller.postSalesReturn,
);

module.exports = router;