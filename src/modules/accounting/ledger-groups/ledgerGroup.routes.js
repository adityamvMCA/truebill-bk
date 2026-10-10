const express = require("express");
const verifyToken = require("../../../middleware/authMiddleware");
const {
  getGroups,
  seedGroups,
  createGroup,
} = require("./ledgerGroup.controller");

const router = express.Router();

const requireTenantAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").trim().toLowerCase();
  const platformRole = String(req.user?.platformRole || "")
    .trim()
    .toLowerCase();

  /*
    Platform developer has no tenantId, so it must not create
    accounting data accidentally for an unknown tenant.

    Only a tenant user with tenantId and role admin can seed or
    customize accounts for their own tenant.
  */
  if (!req.user?.tenantId) {
    return res.status(403).json({
      success: false,
      message:
        "Tenant context is required. Login using a tenant admin account.",
    });
  }

  if (role !== "admin" && platformRole !== "tenant_admin") {
    return res.status(403).json({
      success: false,
      message: "Only a tenant admin can manage ledger groups",
    });
  }

  next();
};

/*
  Any authenticated tenant user can read the tenant's group list.
  The controller/service always filters by req.user.tenantId.
*/
router.get("/", verifyToken, getGroups);

/*
  Only the specific tenant's admin can create/seed groups.
*/
router.post("/seed", verifyToken, requireTenantAdmin, seedGroups);

router.post("/", verifyToken, requireTenantAdmin, createGroup);

module.exports = router;