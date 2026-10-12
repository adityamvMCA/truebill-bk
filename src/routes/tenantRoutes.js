const express = require("express");

const {
  getTenants,
  getTenantById,
  createTenant,
  updateTenant,
  getTenantUsers,
  createTenantUser,
  updateTenantUser,
  updateTenantUserStatus,
} = require("../controllers/tenantController");

const verifyToken = require("../middleware/authMiddleware");
const requirePlatformRole = require("../middleware/platformMiddleware");

const router = express.Router();

router.use(verifyToken, requirePlatformRole("developer", "support"));

router.get("/", getTenants);

router.get("/:tenantId", getTenantById);

router.post("/", createTenant);

router.put("/:tenantId", updateTenant);

router.get("/:tenantId/users", getTenantUsers);

router.post("/:tenantId/users", createTenantUser);

router.put("/users/:userId", updateTenantUser);

router.patch("/users/:userId/status", updateTenantUserStatus);

module.exports = router;
