/*
  Admin check for expense approval.

  ADJUST getRole() / ADMIN_ROLES to match how your auth token or User model
  stores the role (for example req.user.role, req.user.roleName,
  req.user.role.name). Only these roles may approve or reject expenses.
*/

// const ADMIN_ROLES = ["admin", "tenant_admin", "tenantadmin", "owner"];
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
