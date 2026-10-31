// const express = require("express");

// const {
//   createSupplier,
//   deleteSupplier,
//   getSupplierByCode,
//   getSuppliers,
//   updateSupplier,
// } = require("./supplier.controller");

// const {
//   validateCreateSupplier,
//   validateUpdateSupplier,
// } = require("./supplier.validation");

// const verifyToken = require("../../middleware/authMiddleware");
// const resolveTenant = require("../../middleware/tenantMiddleware");
// const requirePermission = require(
//   "../../middleware/permissionMiddleware",
// );
// const { importSuppliers } = require("./supplier.import");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// router.get(
//   "/",
//   requirePermission("supplier.view"),
//   getSuppliers,
// );

// router.post(
//   "/",
//   requirePermission("supplier.create"),
//   validateCreateSupplier,
//   createSupplier,
// );

// router.get(
//   "/code/:supplierCode",
//   requirePermission("supplier.view"),
//   getSupplierByCode,
// );

// router.put(
//   "/code/:supplierCode",
//   requirePermission("supplier.update"),
//   validateUpdateSupplier,
//   updateSupplier,
// );

// router.delete(
//   "/code/:supplierCode",
//   requirePermission("supplier.delete"),
//   deleteSupplier,
// );
// router.post(
//   "/import",
//   requirePermission("supplier.create"),
//   importSuppliers,
// );
// module.exports = router;

const express = require("express");

const {
  createSupplier,
  deleteSupplier,
  getSupplierByCode,
  getSuppliers,
  getSupplierStats,
  updateSupplier,
  bulkUpdateSupplierStatus,
} = require("./supplier.controller");

const {
  validateCreateSupplier,
  validateUpdateSupplier,
  validateListSupplier,
  validateBulkStatusSupplier,
} = require("./supplier.validation");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const { importSuppliers } = require("./supplier.import");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  requirePermission("supplier.view"),
  validateListSupplier,
  getSuppliers
);

router.get(
  "/stats",
  requirePermission("supplier.view"),
  getSupplierStats
);

router.patch(
  "/bulk-status",
  requirePermission("supplier.update"),
  validateBulkStatusSupplier,
  bulkUpdateSupplierStatus
);

router.post(
  "/",
  requirePermission("supplier.create"),
  validateCreateSupplier,
  createSupplier
);

router.get(
  "/code/:supplierCode",
  requirePermission("supplier.view"),
  getSupplierByCode
);

router.put(
  "/code/:supplierCode",
  requirePermission("supplier.update"),
  validateUpdateSupplier,
  updateSupplier
);

router.delete(
  "/code/:supplierCode",
  requirePermission("supplier.delete"),
  deleteSupplier
);

router.post(
  "/import",
  requirePermission("supplier.create"),
  importSuppliers
);

module.exports = router;