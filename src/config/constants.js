const {
  MODULES,
  p,
  unique,
  allFeatures,
  allPermissions,
} = require("./accessModel");

const PLATFORM_ROLES = {
  DEVELOPER: "developer",
  SUPPORT: "support",
  TENANT: "tenant",
};

const moduleFeatures = (...keys) => keys.flatMap((key) => MODULES[key].features);

// Adds "dashboard" and the parent module key ("sales", "bank", ...) for
// every feature, because parent menus and parent gates use the module key.
const withParents = (features) =>
  unique([
    "dashboard",
    ...features.flatMap((feature) => {
      const parent = String(feature).split(".")[0];
      return MODULES[parent] ? [parent, feature] : [feature];
    }),
  ]);

/* ----------------------------------------------------------------------
   FEATURES PER ROLE
   ---------------------------------------------------------------------- */

const ROLE_FEATURES = {
  admin: withParents(allFeatures()),

  // Everything except company/user/role settings.
  manager: withParents(
    allFeatures().filter((feature) => !feature.startsWith("settings.")),
  ),

  accountant: withParents([
    "sales.customers",
    "sales.quotations",
    "sales.invoices",
    "sales.returns",
    "sales.customerReceipts",
    "sales.creditNotes",
    "sales.reports",

    "purchase.vendors",
    "purchase.orders",
    "purchase.grn",
    "purchase.invoices",
    "purchase.returns",
    "purchase.debitNotes",
    "purchase.supplierPayments",
    "purchase.reports",

    "inventory.products",
    "inventory.hsn",
    "inventory.taxRates",
    "inventory.stock",
    "inventory.warehouses",
    "inventory.transfers",
    "inventory.adjustments",
    "inventory.reports",

    ...moduleFeatures("accounting", "bank", "expenses", "reports"),

    "gst.summary",
    "gst.gstrReports",
  ]),

  sales: withParents([
    "sales.customers",
    "sales.quotations",
    "sales.orders",
    "sales.delivery",
    "sales.invoices",
    "sales.returns",
    "sales.customerReceipts",
    "sales.creditNotes",
    "sales.reports",

    "purchase.requisitions",

    "reports.sales",
  ]),

  purchase: withParents([
    "purchase.vendors",
    "purchase.requisitions",
    "purchase.rfq",
    "purchase.quotations",
    "purchase.orders",
    "purchase.grn",
    "purchase.invoices",
    "purchase.returns",
    "purchase.debitNotes",
    "purchase.reports",

    "inventory.products",

    "reports.purchase",
  ]),

  inventory: withParents([
    ...moduleFeatures("inventory"),

    "purchase.grn",

    "production.orders",
    "production.bom",
    "production.workOrders",

    "reports.inventory",
  ]),

  viewer: withParents([
    "reports.sales",
    "reports.purchase",
    "reports.inventory",
  ]),
};

/* ----------------------------------------------------------------------
   ACTION CODES PER ROLE
   ---------------------------------------------------------------------- */

const ROLE_CODES = {
  admin: allPermissions(),

  // Everything admin can do, except deleting records and changing
  // the tax configuration.
  manager: allPermissions().filter(
    (code) => !code.endsWith(".delete") && code !== "taxConfiguration.update",
  ),

  accountant: [
    ...p("customer", "view", "create", "update"),
    ...p("supplier", "view", "create", "update"),

    ...p("ledger", "view", "create", "update"),
    ...p("ledgerGroup", "view", "create"),

    ...p("product", "view"),
    "stock-movement.view",

    ...p("salesQuotation", "view", "create", "update", "issue", "delete"),
    ...p("salesInvoice", "view", "create", "update", "post"),
    ...p("salesReturn", "view", "post"),
    ...p("customerReceipt", "view", "create", "post"),

    ...p("purchaseOrder", "view"),
    ...p("goodsReceipt", "view"),
    ...p("purchaseBill", "view", "create", "update", "post"),
    ...p("purchaseReturn", "view", "post"),
    ...p("supplierPayment", "view", "create", "post"),

    ...p("bank", "view", "create", "update"),
    ...p("bankReconciliation", "view", "reconcile"),

    "customerOutstanding.view",
    "supplierOutstanding.view",

    "gstSummary.view",
    "gstrReports.view",
    ...p("taxConfiguration", "view"),

    ...p("tax", "view", "create", "update"),
    ...p("stock.adjustment", "view", "create"),
    ...p(
      "warehouse",
      "view",
      "create",
      "update",
      "initialize",
      "enableMultiWarehouse",
    ),
    ...p("stockTransfer", "view", "create"),

    ...p("expense", "view", "create", "update", "approve"),
    ...p("note", "view", "create"),
    ...p("tds", "view", "deduct"),
  ],

  sales: [
    ...p("customer", "view", "create", "update"),
    ...p("supplier", "view"),

    ...p("product", "view"),
    "stock-movement.view",
    ...p("ledger", "view"),

    ...p("salesQuotation", "view", "create", "update", "issue"),
    ...p("salesOrder", "view", "create", "update", "confirm", "cancel"),
    ...p("deliveryNote", "view", "create", "update", "dispatch", "deliver"),
    ...p("salesInvoice", "view", "create", "update"),
    ...p("salesReturn", "view", "create"),
    ...p("customerReceipt", "view", "create", "post"),

    ...p("purchaseRequisition", "view", "create"),
  ],

  purchase: [
    ...p("customer", "view"),
    ...p("supplier", "view", "create", "update"),

    ...p("product", "view", "create", "update"),
    ...p("category", "view"),
    ...p("brand", "view"),
    ...p("hsn", "view"),
    ...p("tax", "view"),
    "stock-movement.view",

    ...p("purchaseRequisition", "view", "create", "update", "cancel"),
    ...p(
      "purchaseRfq",
      "view",
      "create",
      "update",
      "issue",
      "close",
      "cancel",
      "createDirect",
    ),
    ...p("supplierQuotation", "view", "create", "update", "cancel"),
    ...p("quotationComparison", "view"),
    ...p("purchaseOrder", "view", "create", "update", "cancel"),
    ...p("goodsReceipt", "view", "create"),
    ...p("purchaseBill", "view", "create", "update"),
    ...p("purchaseReturn", "view", "create"),
  ],

  inventory: [
    ...p("supplier", "view"),

    ...p("product", "view", "create", "update"),
    ...p("category", "view", "create", "update"),
    ...p("brand", "view", "create", "update"),
    ...p("hsn", "view", "create", "update"),
    ...p("tax", "view"),

    ...p("warehouse", "view", "create", "update", "initialize"),
    ...p("stockTransfer", "view", "create"),

    "stock-movement.view",
    "stock-adjustment.create",
    ...p("stock.adjustment", "view", "create"),

    ...p("goodsReceipt", "view", "create"),
    ...p("purchaseOrder", "view"),
  ],

  viewer: [
    ...p("customer", "view"),
    ...p("supplier", "view"),
    ...p("ledger", "view"),
    ...p("product", "view"),
    "stock-movement.view",
    ...p("purchaseBill", "view"),
  ],
};

/* ----------------------------------------------------------------------
   Strings that earlier code stored in the permission list (menu ids and
   feature aliases). Kept so nothing that still reads them breaks.
   ---------------------------------------------------------------------- */

const LEGACY_ENTRIES = [
  "customers-outstanding",
  "accounting-bank-reconciliation",
  "accounting.banks",
];

const LEGACY_BY_ROLE = {
  admin: LEGACY_ENTRIES,
  manager: LEGACY_ENTRIES,
  accountant: LEGACY_ENTRIES,
};

const ROLE_PERMISSIONS = Object.fromEntries(
  Object.keys(ROLE_FEATURES).map((role) => [
    role,
    unique([
      ...ROLE_FEATURES[role],
      ...(ROLE_CODES[role] || []),
      ...(LEGACY_BY_ROLE[role] || []),
    ]),
  ]),
);

module.exports = {
  PLATFORM_ROLES,
  ROLE_FEATURES,
  ROLE_PERMISSIONS,
};