const mongoose = require("mongoose");
const Tenant = require("../models/Tenant");
const User = require("../models/User");

const resolveTenant = async (req, res, next) => {
  try {
    const isPlatform =
      req.user.platformRole === "developer" ||
      req.user.platformRole === "support";

    const headerTenantId =
      req.headers["x-tenant-id"] || req.headers["x-selected-tenant-id"];

    let tenantId = isPlatform ? headerTenantId : (headerTenantId || req.user.tenantId);

    if (!tenantId || !mongoose.isValidObjectId(tenantId))
      return res
        .status(400)
        .json({ success: false, message: "Invalid or missing tenant" });

    const tenant = await Tenant.findOne({ _id: tenantId, isActive: true });
    if (!tenant)
      return res
        .status(404)
        .json({ success: false, message: "Tenant not found or inactive" });

    if (["suspended", "cancelled"].includes(tenant.status))
      return res
        .status(403)
        .json({ success: false, message: `Tenant is ${tenant.status}` });

    // If tenant user requested a different tenant via header, verify authorization
    if (!isPlatform && headerTenantId && String(headerTenantId) !== String(req.user.tenantId)) {
      const userId = req.user.userId || req.user._id || req.user.id;
      const isOwner = String(tenant.createdBy) === String(userId);
      let isMember = false;
      const dbUser = await User.findById(userId).select("tenants role primaryTenantId").lean();

      const isParentAdmin =
        dbUser?.role === "admin" &&
        tenant.parentTenantId &&
        String(tenant.parentTenantId) === String(dbUser?.primaryTenantId);

      if (Array.isArray(dbUser?.tenants)) {
        isMember = dbUser.tenants.some((t) => String(t.tenantId) === String(headerTenantId));
      }

      if (!isOwner && !isMember && !isParentAdmin) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized access to this business" });
      }
    }

    req.tenant = tenant;
    req.tenantId = tenant._id;
    next();
  } catch (e) {
    next(e);
  }
};
module.exports = resolveTenant;
