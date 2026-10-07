const express = require("express");
const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
} = require("../controllers/customerController");
const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const router = express.Router();
router.use(verifyToken, resolveTenant);
router.get("/", requirePermission("customer.view"), getCustomers);
router.post("/", requirePermission("customer.create"), createCustomer);
router.get("/:id", requirePermission("customer.view"), getCustomerById);
router.put("/:id", requirePermission("customer.update"), updateCustomer);
router.delete("/:id", requirePermission("customer.delete"), deleteCustomer);
module.exports = router;
