const LegacyLedger = require("../modules/accounting/ledgers/ledger.model");

const LegacyLedgerGroup = require("../modules/accounting/ledger-groups/ledgerGroup.model");

const LegacyAuditLog = require("../models/AuditLog");

const LegacyBank = require("../modules/banks/bank.model");

const LegacyJournal = require("../modules/accounting/journals/journal.model");

const LegacyPurchaseBill = require("../modules/purchase-bills/purchaseBill.model");

const LegacyStockMovement = require("../modules/stock-movements/stockMovement.model");

const LegacySupplier = require("../modules/suppliers/supplier.model");

const LegacyProduct = require("../modules/products/product.model");

const LegacySalesInvoice = require("../modules/sales-invoices/salesInvoice.model");

const LegacyCustomer = require("../modules/customers/customer.model");

const LegacyCustomerReceipt = require("../modules/customer-receipts/customerReceipt.model");

const LegacySupplierPayment = require("../modules/supplier-payments/supplierPayment.model");

const LegacySalesQuotation = require("../modules/sales-quotations/salesQuotation.model");

const LegacySalesOrder = require("../modules/sales-orders/salesOrder.model");

const LegacyDeliveryNote = require("../modules/delivery-notes/deliveryNote.model");
const LegacySalesReturn = require("../modules/sales-returns/salesReturn.model");
const taxConfigurationSchema = require("../modules/accounting/taxconfiguration/taxConfiguration.model");
const BankClearingSchema = require("../modules/accounting/bankreconciliation/bankClearing.model");
const BankReconciliationschema = require("../modules/accounting/bankreconciliation/bankReconciliation.model");
const LegacyPurchaseRequisition = require("../modules/purchase-requisitions/purchaseRequisition.model");
const LegacyPurchaseRfq = require("../modules/purchase-rfqs/purchaseRfq.model");
const LegacySupplierQuotation = require("../modules/supplier-quotations/supplierQuotation.model");
const LegacyPurchaseOrder = require("../modules/purchase-orders/purchaseOrder.model");
const LegacyGoodsReceipt = require("../modules/goods-receipts/goodsReceipt.model");
const LegacyStockTransfer = require("../modules/Inventory/stock-transfers/stockTransfer.model");
const assertConnection = (connection) => {
  if (
    !connection ||
    typeof connection.model !== "function" ||
    !connection.models
  ) {
    throw new Error("A valid Mongoose connection is required");
  }

  if (connection.readyState !== 1) {
    throw new Error("The database connection is not ready");
  }
};
const assertSourceModel = (sourceModel, label) => {
  if (
    typeof sourceModel !== "function" ||
    typeof sourceModel.modelName !== "string" ||
    !sourceModel.schema ||
    typeof sourceModel.schema.clone !== "function" ||
    !sourceModel.collection?.name
  ) {
    const exportKeys =
      sourceModel &&
      (typeof sourceModel === "object" || typeof sourceModel === "function")
        ? Object.keys(sourceModel)
        : [];

    throw new Error(
      `Invalid model export for ${label}. ` +
        "Expected a compiled Mongoose model with " +
        "modelName, schema, and collection.name. " +
        `Received type: ${typeof sourceModel}; ` +
        `export keys: ${exportKeys.join(", ") || "(none)"}. ` +
        "Check the model file's module.exports and circular imports.",
    );
  }

  return sourceModel;
};
const registerModel = (connection, sourceModel, label) => {
  assertSourceModel(sourceModel, label);

  const name = sourceModel.modelName;

  if (connection.models[name]) {
    return connection.models[name];
  }

  const schema = sourceModel.schema.clone();

  // Provisioning explicitly creates collections and indexes.
  schema.set("autoCreate", false);
  schema.set("autoIndex", false);

  return connection.model(name, schema, sourceModel.collection.name);
};
const assertAccountingModels = (models) => {
  if (!models || typeof models !== "object") {
    throw new Error("Accounting models must be provided");
  }

  const { Ledger, LedgerGroup } = models;

  if (
    Ledger?.modelName !== "AccountingLedger" ||
    LedgerGroup?.modelName !== "LedgerGroup"
  ) {
    throw new Error("Ledger and LedgerGroup models are required");
  }

  if (Ledger.db !== LedgerGroup.db) {
    throw new Error("Accounting models must use the same database connection");
  }

  return {
    Ledger,
    LedgerGroup,
  };
};
const LegacyPurchaseReturn = require("../modules/purchase-returns/purchaseReturn.model");
const LegacyProductCategory = require("../modules/Inventory/product-categories/productCategory.model");
const LegacyProductUnit = require("../modules/Inventory/product-units/productUnit.model");
const LegacyProductBrand = require("../modules/Inventory/product-brands/productBrand.model");
const LegacyHsnSacCode = require("../modules/Inventory/hsn-sac-codes/hsnSacCode.model");
const LegacyTaxRate = require("../modules/tax-rates/taxRate.model");
const LegacyStockAdjustment = require("../modules/Inventory/stock-adjustments/stockAdjustment.model");
const LegacyWarehouse = require("../modules/Inventory/warehouses/warehouse.model");
const LegacyWarehouseStock = require("../modules/Inventory/warehouse-stock/warehouseStock.model");
const LegacyInventorySettings = require("../modules/Inventory/warehouses/inventorySettings.model");
const ExpenseSchema = require("../modules/accounting/Expenses/expense.model");
const noteSchema = require("../modules/accounting/Note/note.model");
const {
  TdsNature: LegacyTdsNature,
  TdsDeduction: LegacyTdsDeduction,
  TdsChallan: LegacyTdsChallan,
} = require("../modules/accounting/tds/tds.models");
const getTenantAccountingModels = (connection) => {
  assertConnection(connection);

  const sources = {
    LedgerGroup: LegacyLedgerGroup,
    Ledger: LegacyLedger,
    AuditLog: LegacyAuditLog,
    Bank: LegacyBank,
    Journal: LegacyJournal,
    PurchaseBill: LegacyPurchaseBill,
    StockMovement: LegacyStockMovement,
    Supplier: LegacySupplier,
    Product: LegacyProduct,
    SalesInvoice: LegacySalesInvoice,
    Customer: LegacyCustomer,
    CustomerReceipt: LegacyCustomerReceipt,
    SupplierPayment: LegacySupplierPayment,
    SalesQuotation: LegacySalesQuotation,
    SalesOrder: LegacySalesOrder,
    DeliveryNote: LegacyDeliveryNote,
    SalesReturn: LegacySalesReturn, // NEW
    TaxConfiguration: taxConfigurationSchema,
    BankClearing: BankClearingSchema,
    BankReconciliation: BankReconciliationschema,
    PurchaseRequisition: LegacyPurchaseRequisition,
    PurchaseRfq: LegacyPurchaseRfq,
    SupplierQuotation: LegacySupplierQuotation,
    PurchaseOrder: LegacyPurchaseOrder,
    GoodsReceipt: LegacyGoodsReceipt,
    PurchaseReturn: LegacyPurchaseReturn,
    ProductCategory: LegacyProductCategory,
    ProductUnit: LegacyProductUnit,
    ProductBrand: LegacyProductBrand,
    HsnSacCode: LegacyHsnSacCode,
    TaxRate: LegacyTaxRate,
    StockAdjustment: LegacyStockAdjustment,
    Warehouse: LegacyWarehouse,
    InventorySettings: LegacyInventorySettings,
    WarehouseStock: LegacyWarehouseStock,
    StockTransfer: LegacyStockTransfer,
    Expense: ExpenseSchema,
    AccountingNote: noteSchema,
    TdsNature: LegacyTdsNature,
    TdsDeduction: LegacyTdsDeduction,
    TdsChallan: LegacyTdsChallan,
  };

  const models = {};

  for (const [label, sourceModel] of Object.entries(sources)) {
    models[label] = registerModel(connection, sourceModel, label);
  }

  return models;
};
const resolveAccountingSeedModels = (models) => {
  // Preserve existing callers.
  // Invalid explicit context must never fall back.
  if (models === undefined) {
    return {
      Ledger: LegacyLedger,
      LedgerGroup: LegacyLedgerGroup,
    };
  }

  return assertAccountingModels(models);
};

module.exports = {
  getTenantAccountingModels,
  resolveAccountingSeedModels,
};
