
const express = require("express");

const {
  createProduct,
  getProducts,
  getProductByCode,
  updateProduct,
  deleteProduct,
} = require("./product.controller");

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

router.get(
  "/",
  requirePermission("product.view"),
  getProducts
);

router.post(
  "/",
  requirePermission("product.create"),
  validateCreateProduct,
  createProduct
);

router.post(
  "/import",
  requirePermission("product.create"),
  importProducts
);

router.get(
  "/code/:productCode",
  requirePermission("product.view"),
  getProductByCode
);

router.put(
  "/code/:productCode",
  requirePermission("product.update"),
  validateUpdateProduct,
  updateProduct
);

router.delete(
  "/code/:productCode",
  requirePermission("product.delete"),
  deleteProduct
);

module.exports = router;