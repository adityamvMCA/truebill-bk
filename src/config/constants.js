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

    "product.view",
    "product.create",
    "product.update",
    "product.delete",

    "stock-movement.view",
    "stock-adjustment.create",
  ],

  accountant: [
    "customer.view",
    "customer.create",
    "customer.update",

    "ledger.view",
    "ledger.create",
    "ledger.update",

    "product.view",

    "stock-movement.view",
  ],

  sales: [
    "customer.view",
    "customer.create",
    "customer.update",

    "product.view",
  ],

  purchase: [
    "customer.view",

    "product.view",
    "product.create",
    "product.update",

    "stock-movement.view",
  ],

  inventory: [
    "product.view",
    "product.create",
    "product.update",

    "stock-movement.view",
    "stock-adjustment.create",
  ],

  viewer: [
    "customer.view",
    "ledger.view",

    "product.view",
    "stock-movement.view",
  ],
};
console.log(
  "ROLE_PERMISSIONS LOADED:",
  ROLE_PERMISSIONS.admin
);
module.exports = {
  PLATFORM_ROLES,
  ROLE_PERMISSIONS,
};