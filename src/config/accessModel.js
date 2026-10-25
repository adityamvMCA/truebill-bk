/**
 * SINGLE SOURCE OF TRUTH for access control.
 *
 * Every module lists
 *   - features:    keys used by subscription plans, sidebar menus and
 *                  frontend route gates (FeatureRoute)
 *   - permissions: action codes used by backend requirePermission()
 *
 * rolePermissions.js (who can do what) and plans.js (what each
 * subscription includes) are both BUILT from this file, so a menu, a route
 * and an API can no longer disagree.
 *
 * Place at: src/config/accessModel.js
 */

const p = (entity, ...actions) =>
  actions.map((action) => `${entity}.${action}`);

const unique = (list) => [...new Set(list)];

const MODULES = {
  dashboard: {
    features: [],
    permissions: [],
  },

  sales: {
    features: [
      "sales.customers",
      "sales.quotations",
      "sales.orders",
      "sales.delivery",
      "sales.invoices",
      "sales.returns",
      "sales.customerReceipts",
      "sales.creditNotes",
      "sales.reports",
    ],
    permissions: [
      ...p("customer", "view", "create", "update", "delete"),
      ...p("salesQuotation", "view", "create", "update", "issue", "delete"),
      ...p(
        "salesOrder",
        "view",
        "create",
        "update",
        "confirm",
        "start",
        "complete",
        "cancel",
        "delete",
      ),
      ...p(
        "deliveryNote",
        "view",
        "create",
        "update",
        "dispatch",
        "deliver",
        "cancel",
        "delete",
      ),
      ...p("salesInvoice", "view", "create", "update", "post", "delete"),
      ...p("salesReturn", "view", "create", "update", "delete", "post"),
      ...p("customerReceipt", "view", "create", "post"),
    ],
  },

  purchase: {
    features: [
      "purchase.vendors",
      "purchase.requisitions",
      "purchase.rfq",
      "purchase.quotations",
      "purchase.orders",
      "purchase.grn",
      "purchase.invoices",
      "purchase.returns",
      "purchase.debitNotes",
      "purchase.supplierPayments",
      "purchase.reports",
    ],
    permissions: [
      ...p("supplier", "view", "create", "update", "delete"),
      ...p(
        "purchaseRequisition",
        "view",
        "create",
        "update",
        "approve",
        "reject",
        "cancel",
        "delete",
      ),
      ...p(
        "purchaseRfq",
        "view",
        "create",
        "update",
        "issue",
        "close",
        "cancel",
        "delete",
        "createDirect",
      ),
      ...p("supplierQuotation", "view", "create", "update", "cancel", "delete"),
      ...p("quotationComparison", "view"),
      ...p("purchaseOrder", "view", "create", "update", "cancel"),
      ...p("goodsReceipt", "view", "create"),
      ...p("purchaseBill", "view", "create", "update", "post", "delete"),
      ...p("purchaseReturn", "view", "create", "post"),
      ...p("supplierPayment", "view", "create", "post"),
    ],
  },

  inventory: {
    features: [
      "inventory.products",
      "inventory.categories",
      "inventory.units",
      "inventory.brands",
      "inventory.hsn",
      "inventory.taxRates",
      "inventory.warehouses",
      "inventory.stock",
      "inventory.transfers",
      "inventory.adjustments",
      "inventory.reports",
    ],
    permissions: [
      ...p("product", "view", "create", "update", "delete"),
      ...p("category", "view", "create", "update"),
      ...p("brand", "view", "create", "update"),
      ...p("hsn", "view", "create", "update"),
      ...p("tax", "view", "create", "update"),
      ...p(
        "warehouse",
        "view",
        "create",
        "update",
        "initialize",
        "enableMultiWarehouse",
      ),
      ...p("stockTransfer", "view", "create"),
      "stock-movement.view",
      "stock-adjustment.create",
      ...p("stock.adjustment", "view", "create"),
    ],
  },

  accounting: {
    features: [
      "accounting.chartOfAccounts",
      "accounting.journalEntries",
      "accounting.ledgers",
      "accounting.trialBalance",
      "accounting.reports",
      "accounting.receivables",
      "accounting.payables",
      "accounting.cashBook",
      "accounting.pettyCash",
      "accounting.notes",
      "accounting.tds",
    ],
    permissions: [
      ...p("ledger", "view", "create", "update", "delete"),
      ...p("ledgerGroup", "view", "create"),
      "customerOutstanding.view",
      "supplierOutstanding.view",
      // NEW - confirm these names against your backend (see auditPermissions.js)
      ...p("note", "view", "create"),
      ...p("tds", "view", "deduct", "manage"),
    ],
  },

  gst: {
    features: ["gst.summary", "gst.gstrReports", "gst.taxConfiguration"],
    permissions: [
      ...p("taxConfiguration", "view", "update"),
      "gstSummary.view",
      "gstrReports.view",
    ],
  },

  bank: {
    features: [
      "bank.accounts",
      "bank.receipts",
      "bank.payments",
      "bank.transfers",
      "bank.reconciliation",
      "bank.ledger",
    ],
    permissions: [
      ...p("bank", "view", "create", "update"),
      ...p("bankReconciliation", "view", "reconcile"),
    ],
  },

  expenses: {
    features: [
      "expenses.list",
      "expenses.categories",
      "expenses.approvals",
      "expenses.budgets",
    ],
    // NEW - confirm these names against your backend
    permissions: [
      ...p("expense", "view", "create", "update", "approve", "delete"),
    ],
  },

  production: {
    features: [
      "production.orders",
      "production.bom",
      "production.workOrders",
      "production.reports",
    ],
    permissions: [],
  },

  hr: {
    features: ["hr.employees", "hr.attendance", "hr.leave", "hr.payroll"],
    permissions: [],
  },

  assets: {
    features: [
      "assets.list",
      "assets.categories",
      "assets.depreciation",
      "assets.reports",
    ],
    permissions: [],
  },

  crm: {
    features: ["crm.leads", "crm.opportunities", "crm.followups"],
    permissions: [],
  },

  projects: {
    features: ["projects.list", "projects.tasks", "projects.timesheets"],
    permissions: [],
  },

  quality: {
    features: ["quality.checks", "quality.inspections", "quality.reports"],
    permissions: [],
  },

  reports: {
    features: [
      "reports.sales",
      "reports.purchase",
      "reports.inventory",
      "reports.accounting",
    ],
    permissions: ["customerOutstanding.view", "supplierOutstanding.view"],
  },

  settings: {
    features: [
      "settings.company",
      "settings.users",
      "settings.roles",
      "settings.appearance",
      "settings.notifications",
    ],
    permissions: [],
  },
};

const MODULE_KEYS = Object.keys(MODULES);

const allFeatures = () =>
  unique(MODULE_KEYS.flatMap((key) => MODULES[key].features));

const allPermissions = () =>
  unique(MODULE_KEYS.flatMap((key) => MODULES[key].permissions));

module.exports = {
  MODULES,
  MODULE_KEYS,
  p,
  unique,
  allFeatures,
  allPermissions,
};
