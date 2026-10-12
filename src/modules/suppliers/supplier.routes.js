const express = require("express");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");

const {
  createSupplier,
  deleteSupplier,
  getSupplierByCode,
  getSuppliers,
  updateSupplier,
} = require("./supplier.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", getSuppliers);

router.post("/", createSupplier);

router.get(
  "/code/:supplierCode",
  getSupplierByCode
);

router.put(
  "/code/:supplierCode",
  updateSupplier
);

router.delete(
  "/code/:supplierCode",
  deleteSupplier
);

module.exports = router;