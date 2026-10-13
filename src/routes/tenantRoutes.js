// const express = require("express");

// const {
//   getTenants,
//   getTenantById,
//   createTenant,
//   updateTenant,
//   getTenantUsers,
//   createTenantUser,
//   updateTenantUser,
//   updateTenantUserStatus,
// } = require("../controllers/tenantController");

// const verifyToken = require("../middleware/authMiddleware");
// const requirePlatformRole = require("../middleware/platformMiddleware");

// const router = express.Router();

// router.use(verifyToken, requirePlatformRole("developer", "support"));

// router.get("/", getTenants);

// router.get("/:tenantId", getTenantById);

// router.post("/", createTenant);

// router.put("/:tenantId", updateTenant);

// router.get("/:tenantId/users", getTenantUsers);

// router.post("/:tenantId/users", createTenantUser);

// router.put("/users/:userId", updateTenantUser);

// router.patch("/users/:userId/status", updateTenantUserStatus);

// module.exports = router;



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

const tenantAdminScope = require("../middleware/tenantAdminScope");

const router = express.Router();

const platformOnly = requirePlatformRole(
  "developer",
  "support",
);

router.use(verifyToken);

/*
  Platform-only tenant management.
*/

router.get(
  "/",
  platformOnly,
  getTenants,
);

router.post(
  "/",
  platformOnly,
  createTenant,
);

/*
  Scoped company routes.

  Developer/support can access any tenant.
  A tenant admin can access only their own tenant.
*/

router.get(
  "/:tenantId",
  tenantAdminScope,
  getTenantById,
);

router.put(
  "/:tenantId",
  tenantAdminScope,
  updateTenant,
);

router.get(
  "/:tenantId/users",
  tenantAdminScope,
  getTenantUsers,
);

router.post(
  "/:tenantId/users",
  tenantAdminScope,
  createTenantUser,
);

router.put(
  "/:tenantId/users/:userId",
  tenantAdminScope,
  updateTenantUser,
);

router.patch(
  "/:tenantId/users/:userId/status",
  tenantAdminScope,
  updateTenantUserStatus,
);

module.exports = router;