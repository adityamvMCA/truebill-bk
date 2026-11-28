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

    let tenant = null;

    if (isPlatform) {
      const tenantId = headerTenantId;
      if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or missing tenant" });
      }
      tenant = await Tenant.findOne({ _id: tenantId, isActive: true });
    } else {
      // For tenant users:
      // If a headerTenantId was provided (e.g. multi-company switch), check if valid & authorized
      if (headerTenantId && mongoose.isValidObjectId(headerTenantId)) {
        const candidate = await Tenant.findOne({ _id: headerTenantId, isActive: true });
        if (candidate) {
          const userId = req.user.userId || req.user._id || req.user.id;
          const isOwner = String(candidate.createdBy) === String(userId);
          const dbUser = await User.findById(userId).select("tenants role primaryTenantId").lean();
          const isMember = Array.isArray(dbUser?.tenants) && dbUser.tenants.some((t) => String(t.tenantId) === String(headerTenantId));
          const isParentAdmin = dbUser?.role === "admin" && candidate.parentTenantId && String(candidate.parentTenantId) === String(dbUser?.primaryTenantId);

          if (isOwner || isMember || isParentAdmin || String(headerTenantId) === String(req.user.tenantId)) {
            tenant = candidate;
          }
        }
      }

      // If header was not provided, invalid, unauthorized, or stale from a previous user/developer session,
      // safely fall back to the user's authentic assigned tenantId!
      if (!tenant && req.user.tenantId && mongoose.isValidObjectId(req.user.tenantId)) {
        tenant = await Tenant.findOne({ _id: req.user.tenantId, isActive: true });
      }
    }

    if (!tenant) {
      return res
        .status(404)
        .json({ success: false, message: "Tenant not found or inactive" });
    }

    if (["suspended", "cancelled"].includes(tenant.status)) {
      return res
        .status(403)
        .json({ success: false, message: `Tenant is ${tenant.status}` });
    }

    req.tenant = tenant;
    req.tenantId = tenant._id;
    next();
  } catch (e) {
    next(e);
  }
};

module.exports = resolveTenant;
