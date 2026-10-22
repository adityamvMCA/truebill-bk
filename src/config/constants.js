const PLATFORM_ROLES = {
  DEVELOPER: "developer",
  SUPPORT: "support",
  TENANT: "tenant",
};
const SALES_ORDER_PERMISSIONS = [
  "salesOrder.view",
  "salesOrder.create",
  "salesOrder.update",
  "salesOrder.confirm",
  "salesOrder.start",
  "salesOrder.complete",
  "salesOrder.cancel",
  "salesOrder.delete",
  "salesReturn.view",
  "salesReturn.create",
  "salesReturn.view",
  "salesReturn.update",
  "salesReturn.delete",
];
const DELIVERY_NOTE_PERMISSIONS = [
  "deliveryNote.view",
  "deliveryNote.create",
  "deliveryNote.update",
  "deliveryNote.dispatch",
  "deliveryNote.deliver",
  "deliveryNote.cancel",
  "deliveryNote.delete",
];

const PURCHASE_REQUISITION_PERMISSIONS = [
  "purchaseRequisition.view",
  "purchaseRequisition.create",
  "purchaseRequisition.update",
  "purchaseRequisition.approve",
  "purchaseRequisition.reject",
  "purchaseRequisition.cancel",
  "purchaseRequisition.delete",
];
const PURCHASE_RFQ_PERMISSIONS = [
  "purchaseRfq.view",
  "purchaseRfq.create",
  "purchaseRfq.update",
  "purchaseRfq.issue",
  "purchaseRfq.close",
  "purchaseRfq.cancel",
  "purchaseRfq.delete",
  "purchaseRfq.createDirect",
];
const SUPPLIER_QUOTATION_PERMISSIONS = [
  "supplierQuotation.view",
  "supplierQuotation.create",
  "supplierQuotation.update",
  "supplierQuotation.cancel",
  "supplierQuotation.delete",
  "quotationComparison.view",
];
const PURCHASE_ORDER_PERMISSIONS = [
  "purchaseOrder.view",
  "purchaseOrder.create",
  "purchaseOrder.update",
  "purchaseOrder.cancel",
];
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
    ...SALES_ORDER_PERMISSIONS,
    ...DELIVERY_NOTE_PERMISSIONS,

    "salesQuotation.view",
    "salesQuotation.create",
    "salesQuotation.update",
    "salesQuotation.issue",
    "salesQuotation.delete",
    "salesReturn.post",
    "taxConfiguration.view",
    "taxConfiguration.update",
    "gstSummary.view",
    "gst.gstrReports",
    "bankReconciliation.view",
    "bankReconciliation.reconcile",
    "customers-outstanding",
    "customerOutstanding.view",
    "supplierOutstanding.view",

    ...PURCHASE_REQUISITION_PERMISSIONS,
    ...PURCHASE_RFQ_PERMISSIONS,
    ...SUPPLIER_QUOTATION_PERMISSIONS,
    ...PURCHASE_ORDER_PERMISSIONS,
    "goodsReceipt.view",
    "goodsReceipt.create",
    "purchaseReturn.view",
    "purchaseReturn.create",
    "purchaseReturn.post",
    "category.view",
    "category.create",
    "category.update",
    "brand.view",
    "brand.create",
    "brand.update",
    "hsn.view",
    "hsn.create",
    "hsn.update",
    "tax.view",
    "tax.create",
    "tax.update",
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
    "salesQuotation.view",
    "salesQuotation.create",
    "salesQuotation.update",
    "salesQuotation.issue",
    "salesQuotation.delete",
    "sales.quotations",
    "gstSummary.view",
    "gst.gstrReports",
    "accounting-bank-reconciliation",
    "customers-outstanding",
    "customerOutstanding.view",
    "supplierOutstanding.view",
    "tax.view",
    "tax.create",
    "tax.update",
    "stock.adjustment.view",
    "stock.adjustment.create",
    "warehouse.view",
    "warehouse.create",
    "warehouse.update",
    "warehouse.initialize"
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
    "salesOrder.view",
    "salesOrder.create",
    "purchaseRequisition.view",
    "purchaseRequisition.create",
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
