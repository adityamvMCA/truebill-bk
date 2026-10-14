// const PLATFORM_ROLES = {
//   DEVELOPER: "developer",
//   SUPPORT: "support",
//   TENANT: "tenant",
// };

// const ROLE_PERMISSIONS = {
//   admin: [
//     "customer.view",
//     "customer.create",
//     "customer.update",
//     "customer.delete",

//     "supplier.view",
//     "supplier.create",
//     "supplier.update",
//     "supplier.delete",

//     "ledger.view",
//     "ledger.create",
//     "ledger.update",
//     "ledger.delete",

//     "ledgerGroup.view",
//     "ledgerGroup.create",

//     "product.view",
//     "product.create",
//     "product.update",
//     "product.delete",

//     "stock-movement.view",
//     "stock-adjustment.create",
//   ],

//   accountant: [
//     "customer.view",
//     "customer.create",
//     "customer.update",

//     "supplier.view",
//     "supplier.create",
//     "supplier.update",

//     "ledger.view",
//     "ledger.create",
//     "ledger.update",

//     "product.view",

//     "stock-movement.view",
//   ],

//   sales: [
//     "customer.view",
//     "customer.create",
//     "customer.update",

//     "supplier.view",

//     "product.view",
//   ],

//   purchase: [
//     "customer.view",

//     "supplier.view",
//     "supplier.create",
//     "supplier.update",

//     "product.view",
//     "product.create",
//     "product.update",

//     "stock-movement.view",
//   ],

//   inventory: [
//     "product.view",
//     "product.create",
//     "product.update",

//     "supplier.view",

//     "stock-movement.view",
//     "stock-adjustment.create",
//   ],

//   viewer: [
//     "customer.view",
//     "supplier.view",

//     "ledger.view",

//     "product.view",
//     "stock-movement.view",
//   ],
// };

// module.exports = {
//   PLATFORM_ROLES,
//   ROLE_PERMISSIONS,
// };

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

    "supplier.view",
    "supplier.create",
    "supplier.update",
    "supplier.delete",

    "ledger.view",
    "ledger.create",
    "ledger.update",
    "ledger.delete",

    "ledgerGroup.view",
    "ledgerGroup.create",

    "product.view",
    "product.create",
    "product.update",
    "product.delete",

    "stock-movement.view",
    "stock-adjustment.create",

    "purchaseBill.view",
    "purchaseBill.create",
    "purchaseBill.update",
    "purchaseBill.post",
    "purchaseBill.delete",

    "supplierPayment.view",
    "supplierPayment.create",
    "supplierPayment.post",
  ],

  accountant: [
    "customer.view",
    "customer.create",
    "customer.update",

    "supplier.view",
    "supplier.create",
    "supplier.update",

    "ledger.view",
    "ledger.create",
    "ledger.update",

    "product.view",

    "stock-movement.view",

    "purchaseBill.view",
    "purchaseBill.create",
    "purchaseBill.update",
    "purchaseBill.post",
  ],

  sales: [
    "customer.view",
    "customer.create",
    "customer.update",

    "supplier.view",

    "product.view",
  ],

  purchase: [
    "customer.view",

    "supplier.view",
    "supplier.create",
    "supplier.update",

    "product.view",
    "product.create",
    "product.update",

    "stock-movement.view",

    "purchaseBill.view",
    "purchaseBill.create",
    "purchaseBill.update",
  ],

  inventory: [
    "product.view",
    "product.create",
    "product.update",

    "supplier.view",

    "stock-movement.view",
    "stock-adjustment.create",
  ],

  viewer: [
    "customer.view",
    "supplier.view",

    "ledger.view",

    "product.view",
    "stock-movement.view",

    "purchaseBill.view",
  ],
};

module.exports = {
  PLATFORM_ROLES,
  ROLE_PERMISSIONS,
};
