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

const registerModel = (connection, sourceModel) => {
  const name = sourceModel.modelName;

  if (connection.models[name]) {
    return connection.models[name];
  }

  const schema = sourceModel.schema.clone();

  // Tenant provisioning explicitly creates
  // collections and indexes before activation.
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

const getTenantAccountingModels = (connection) => {
  assertConnection(connection);

  const LedgerGroup = registerModel(connection, LegacyLedgerGroup);

  const Ledger = registerModel(connection, LegacyLedger);

  const AuditLog = registerModel(connection, LegacyAuditLog);

  const Bank = registerModel(connection, LegacyBank);

  const Journal = registerModel(connection, LegacyJournal);

  const PurchaseBill = registerModel(connection, LegacyPurchaseBill);
  const StockMovement = registerModel(connection, LegacyStockMovement);
  const Product = registerModel(connection, LegacyProduct);
  const Supplier = registerModel(connection, LegacySupplier);
  const SalesInvoice = registerModel(connection, LegacySalesInvoice);

  const Customer = registerModel(connection, LegacyCustomer);
  const CustomerReceipt = registerModel(connection, LegacyCustomerReceipt);
  const SupplierPayment = registerModel(connection, LegacySupplierPayment);
  return {
    LedgerGroup,
    Ledger,
    AuditLog,
    Bank,
    Journal,
    PurchaseBill,
    StockMovement,
    Supplier,
    Product,
    SalesInvoice,
    Customer,
    CustomerReceipt,
    SupplierPayment,
  };
};

const resolveAccountingSeedModels = (models) => {
  // Existing callers continue using the
  // existing database. An invalid explicit
  // model context must never fall back.
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
