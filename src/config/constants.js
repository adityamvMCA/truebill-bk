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

    "salesInvoice.view",
    "salesInvoice.create",
    "salesInvoice.update",
    "salesInvoice.post",
    "salesInvoice.delete",

    "customerReceipt.view",
    "customerReceipt.create",
    "customerReceipt.post",
    "bank.view",
    "bank.create",
    "bank.update",
    "customerOutstanding.view",
    "supplierOutstanding.view",
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
    "bank.view",
    "bank.create",
    "bank.update",
    "accounting.banks",
    "customerOutstanding.view",
    "supplierOutstanding.view",
  ],

  sales: [
    "customer.view",
    "customer.create",
    "customer.update",

    "supplier.view",

    "product.view",

    "salesInvoice.view",
    "salesInvoice.create",

    "customerReceipt.view",
    "customerReceipt.create",
    "customerReceipt.post",

    "ledger.view",
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
