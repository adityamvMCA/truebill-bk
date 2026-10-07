const PLATFORM_ROLES = {
  DEVELOPER: "developer",
  SUPPORT: "support",
  TENANT: "tenant",
};
const ROLE_PERMISSIONS = {
  admin: [
    "customer.view",
    "customer.create",
    "customer.update",
    "customer.delete",
    "ledger.view",
    "ledger.create",
    "ledger.update",
    "ledger.delete",
  ],
  accountant: [
    "customer.view",
    "customer.create",
    "customer.update",
    "ledger.view",
    "ledger.create",
    "ledger.update",
  ],
  sales: ["customer.view", "customer.create", "customer.update"],
  purchase: ["customer.view"],
  inventory: [],
  viewer: ["customer.view", "ledger.view"],
};
module.exports = { PLATFORM_ROLES, ROLE_PERMISSIONS };
