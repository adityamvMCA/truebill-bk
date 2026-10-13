const mongoose = require("mongoose");

const tenantAdminScope = (
  req,
  res,
  next,
) => {
  const user = req.user;

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const isPlatformUser = [
    "developer",
    "support",
  ].includes(user.platformRole);

  const isTenantAdmin =
    user.platformRole === "tenant" &&
    user.role === "admin";

  if (!isPlatformUser && !isTenantAdmin) {
    return res.status(403).json({
      success: false,
      message:
        "Company administrator access required",
    });
  }

  const tenantId = req.params.tenantId;

  if (!mongoose.isValidObjectId(tenantId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid tenant id",
    });
  }

  if (
    isTenantAdmin &&
    String(user.tenantId) !== String(tenantId)
  ) {
    return res.status(403).json({
      success: false,
      message:
        "You cannot access another company's data",
    });
  }

  next();
};

module.exports = tenantAdminScope;