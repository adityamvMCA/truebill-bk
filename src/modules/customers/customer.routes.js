const express = require("express");

const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
} = require("./customer.controller");

const {
  validateCreateCustomer,
  validateUpdateCustomer,
} = require("./customer.validation");

const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get("/", requirePermission("customer.view"), getCustomers);

router.post(
  "/",
  requirePermission("customer.create"),
  validateCreateCustomer,
  createCustomer,
);

router.get(
  "/code/:customerCode",
  requirePermission("customer.view"),
  getCustomerById,
);

router.put(
  "/code/:customerCode",
  requirePermission("customer.update"),
  validateUpdateCustomer,
  updateCustomer,
);

router.delete(
  "/code/:customerCode",
  requirePermission("customer.delete"),
  deleteCustomer,
);

module.exports = router;
