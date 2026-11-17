// const express = require("express");

// const {
//   createProduct,
//   getProducts,
//   getProductByCode,
//   updateProduct,
//   deleteProduct,
//   bulkActionProducts
// } = require("./product.controller");

// const {
//   validateCreateProduct,
//   validateUpdateProduct,
// } = require("./product.validation");

// const verifyToken = require("../../middleware/authMiddleware");
// const resolveTenant = require("../../middleware/tenantMiddleware");
// const requirePermission = require("../../middleware/permissionMiddleware");
// const { importProducts } = require("./product.import");

// const router = express.Router();

// router.use(verifyToken, resolveTenant);

// router.get("/", requirePermission("product.view"), getProducts);

// router.post(
//   "/",
//   requirePermission("product.create"),
//   validateCreateProduct,
//   createProduct,
// );

// router.post("/import", requirePermission("product.create"), importProducts);

// router.get(
//   "/code/:productCode",
//   requirePermission("product.view"),
//   getProductByCode,
// );

// router.put(
//   "/code/:productCode",
//   requirePermission("product.update"),
//   validateUpdateProduct,
//   updateProduct,
// );

// router.delete(
//   "/code/:productCode",
//   requirePermission("product.delete"),
//   deleteProduct,
// );
// router.post(
//   "/bulk-action",
//   requirePermission("product.update"),
//   bulkActionProducts,
// );
// module.exports = router;

const express = require("express");

const {
  createProduct,
  getProducts,
  getProductByCode,
  updateProduct,
  deleteProduct,
  bulkActionProducts,
} = require("./product.controller");

const {
  getStockDetails,
  getPartyWiseReport,
  getGodownReport,
  getPartyPrices,
} = require("./product.report.controller"); // NEW

const {
  validateCreateProduct,
  validateUpdateProduct,
} = require("./product.validation");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const { importProducts } = require("./product.import");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", requirePermission("product.view"), getProducts);

router.post(
  "/",
  requirePermission("product.create"),
  validateCreateProduct,
  createProduct,
);

router.post("/import", requirePermission("product.create"), importProducts);

router.post(
  "/bulk-action",
  requirePermission("product.update"),
  bulkActionProducts,
);

/* ---------- item reports (NEW) ---------- */

router.get(
  "/code/:productCode/reports/stock",
  requirePermission("product.view"),
  getStockDetails,
);

router.get(
  "/code/:productCode/reports/party-wise",
  requirePermission("product.view"),
  getPartyWiseReport,
);

router.get(
  "/code/:productCode/reports/godown",
  requirePermission("product.view"),
  getGodownReport,
);

router.get(
  "/code/:productCode/reports/party-prices",
  requirePermission("product.view"),
  getPartyPrices,
);

/* ---------- single product ---------- */

router.get(
  "/code/:productCode",
  requirePermission("product.view"),
  getProductByCode,
);

router.put(
  "/code/:productCode",
  requirePermission("product.update"),
  validateUpdateProduct,
  updateProduct,
);

router.delete(
  "/code/:productCode",
  requirePermission("product.delete"),
  deleteProduct,
);

module.exports = router;