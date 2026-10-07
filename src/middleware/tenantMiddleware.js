const mongoose = require("mongoose");
const Tenant = require("../models/Tenant");
const resolveTenant = async (req, res, next) => {
  try {
    let tenantId;
    if (
      req.user.platformRole === "developer" ||
      req.user.platformRole === "support"
    )
      tenantId = req.headers["x-tenant-id"];
    else tenantId = req.user.tenantId;
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
    req.tenant = tenant;
    req.tenantId = tenant._id;
    next();
  } catch (e) {
    next(e);
  }
};
module.exports = resolveTenant;
