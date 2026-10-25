const ADMIN_ROLES = ["admin", "tenant_admin", "tenant", "owner", "developer"];

const getRole = (user = {}) =>
  String(user.role?.name || user.role || user.roleName || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const isTenantAdmin = (user) => ADMIN_ROLES.includes(getRole(user));

const requireTenantAdmin = (req, res, next) => {
  if (!isTenantAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Only an admin can approve or reject expenses",
    });
  }

  return next();
};

module.exports = {
  isTenantAdmin,
  requireTenantAdmin,
};
