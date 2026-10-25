// const FEATURE_TREE = {
//   dashboard: [],

//   sales: [
//     "sales.customers",
//     "sales.quotations",
//     "sales.orders",
//     "sales.invoices",
//     "sales.customerReceipts",
//     "sales.creditNotes",
//     "sales.reports",
//     "salesOrder.create",

//     "salesReturn.view",
//     "salesReturn.create",
//     "salesReturn.update",
//     "salesReturn.delete",
//     "salesReturn.post",
//   ],

//   purchase: [
//     "purchase.vendors",
//     "purchase.requisitions",
//     "purchase.rfq",
//     "purchase.quotations",
//     "purchase.orders",
//     "purchase.invoices",
//     "purchase.debitNotes",
//     "purchase.reports",
//     "purchase.supplierPayments",
//   ],

//   inventory: [
//     "inventory.products",
//     "inventory.categories",
//     "inventory.warehouses",
//     "inventory.stock",
//     "inventory.transfers",
//     "inventory.adjustments",
//     "inventory.reports",
//   ],

//   accounting: [
//     "accounting.chartOfAccounts",
//     "accounting.journalEntries",
//     "accounting.ledgers",
//     "accounting.trialBalance",
//     "accounting.reports",
//     "customerOutstanding.view",
//   ],

//   gst: [
//     "gst.summary",
//     "gst.gstrReports",
//     "gst.taxConfiguration",
//     "taxConfiguration.view",
//     "taxConfiguration.update",
//     "gstrReports.view",
//   ],

//   bank: [
//     "bank.accounts",
//     "bank.receipts",
//     "bank.payments",
//     "bank.transfers",
//     "bank.reconciliation",
//     "bankReconciliation.view",
//     "bankReconciliation.reconcile",
//   ],

//   expenses: [
//     "expenses.list",
//     "expenses.categories",
//     "expenses.approvals",
//     "expenses.budgets",
//   ],

//   production: [
//     "production.orders",
//     "production.bom",
//     "production.workOrders",
//     "production.reports",
//   ],

//   hr: ["hr.employees", "hr.attendance", "hr.leave", "hr.payroll"],

//   assets: [
//     "assets.list",
//     "assets.categories",
//     "assets.depreciation",
//     "assets.reports",
//   ],

//   crm: ["crm.leads", "crm.opportunities", "crm.followups"],

//   projects: ["projects.list", "projects.tasks", "projects.timesheets"],

//   quality: ["quality.checks", "quality.inspections", "quality.reports"],

//   reports: [
//     "reports.sales",
//     "reports.purchase",
//     "reports.inventory",
//     "reports.accounting",
//     "customerOutstanding.view",
//     "supplierOutstanding.view",
//   ],

//   settings: [
//     "settings.company",
//     "settings.users",
//     "settings.roles",
//     "settings.appearance",
//     "settings.notifications",
//   ],
// };

// const PLANS = {
//   trial: {
//     name: "Trial",
//     durationDays: 14,
//     includedUsers: 3,
//     extraUserPrice: 0,
//     inherits: [],
//     features: [
//       "dashboard",
//       "sales",
//       "purchase",
//       "inventory",
//       "reports",
//       "settings",
//     ],
//     limits: {
//       users: 3,
//       invoices: 50,
//       products: 100,
//       storageMb: 500,
//     },
//   },

//   basic: {
//     name: "Basic",
//     durationDays: 365,
//     includedUsers: 3,
//     extraUserPrice: 199,
//     inherits: [],
//     features: [
//       "dashboard",
//       "sales",
//       "purchase",
//       "inventory",
//       "accounting",
//       "gst",
//       "bank",
//       "expenses",
//       "reports",
//       "settings",
//     ],
//     limits: {
//       users: 3,
//       invoices: 1000,
//       products: 1000,
//       storageMb: 2000,
//     },
//   },

//   standard: {
//     name: "Standard",
//     durationDays: 365,
//     includedUsers: 10,
//     extraUserPrice: 249,
//     inherits: ["basic"],
//     features: [
//       "production",
//       "assets",
//       "crm",
//       "gst.eInvoice",
//       "gst.eWayBill",
//       "gstrReports.view",
//       "settings.auditLogs",
//       "sales",
//     ],
//     limits: {
//       users: 10,
//       invoices: 5000,
//       products: 5000,
//       storageMb: 10000,
//     },
//   },

//   premium: {
//     name: "Premium",
//     durationDays: 365,
//     includedUsers: 25,
//     extraUserPrice: 299,
//     inherits: ["standard"],
//     features: ["projects", "quality", "hr", "settings.api"],
//     limits: {
//       users: 25,
//       invoices: null,
//       products: null,
//       storageMb: 50000,
//     },
//   },
// };

// module.exports = {
//   PLANS,
//   FEATURE_TREE,
// };


/**
 * Subscription plans and the feature tree.
 *
 * Replaces the file that currently exports PLANS and FEATURE_TREE.
 * FEATURE_TREE is generated from accessModel.js so it always contains every
 * feature key and every permission code the app uses.
 *
 * A plan lists parent keys ("sales") which expand to everything in
 * FEATURE_TREE.sales, or individual keys ("gst.eInvoice").
 */

const { MODULES, unique } = require("./accessModel");

const FEATURE_TREE = Object.fromEntries(
  Object.entries(MODULES).map(([key, module]) => [
    key,
    unique([...module.features, ...module.permissions]),
  ]),
);

const PLANS = {
  trial: {
    name: "Trial",
    durationDays: 14,
    includedUsers: 3,
    extraUserPrice: 0,
    inherits: [],
    features: [
      "dashboard",
      "sales",
      "purchase",
      "inventory",
      "reports",
      "settings",
    ],
    limits: {
      users: 3,
      invoices: 50,
      products: 100,
      storageMb: 500,
    },
  },

  basic: {
    name: "Basic",
    durationDays: 365,
    includedUsers: 3,
    extraUserPrice: 199,
    inherits: [],
    features: [
      "dashboard",
      "sales",
      "purchase",
      "inventory",
      "accounting",
      "gst",
      "bank",
      "expenses",
      "reports",
      "settings",
    ],
    limits: {
      users: 3,
      invoices: 1000,
      products: 1000,
      storageMb: 2000,
    },
  },

  standard: {
    name: "Standard",
    durationDays: 365,
    includedUsers: 10,
    extraUserPrice: 249,
    inherits: ["basic"],
    // Add-on features that must NOT live in FEATURE_TREE (otherwise Basic
    // would receive them through its parent keys): e-invoice, e-way bill,
    // audit logs.
    features: [
      "production",
      "assets",
      "crm",
      "gst.eInvoice",
      "gst.eWayBill",
      "settings.auditLogs",
    ],
    limits: {
      users: 10,
      invoices: 5000,
      products: 5000,
      storageMb: 10000,
    },
  },

  premium: {
    name: "Premium",
    durationDays: 365,
    includedUsers: 25,
    extraUserPrice: 299,
    inherits: ["standard"],
    features: ["projects", "quality", "hr", "settings.api"],
    limits: {
      users: 25,
      invoices: null,
      products: null,
      storageMb: 50000,
    },
  },
};

/**
 * Every feature key and permission code a plan unlocks
 * (own features + inherited plans, parent keys expanded).
 */
const resolvePlanFeatures = (planKey, visited = new Set()) => {
  const plan = PLANS[planKey];
  const result = new Set();

  if (!plan || visited.has(planKey)) {
    return result;
  }

  visited.add(planKey);

  for (const parent of plan.inherits || []) {
    for (const feature of resolvePlanFeatures(parent, visited)) {
      result.add(feature);
    }
  }

  for (const feature of plan.features || []) {
    result.add(feature);

    for (const child of FEATURE_TREE[feature] || []) {
      result.add(child);
    }
  }

  return result;
};

const isFeatureInPlan = (planKey, feature) =>
  resolvePlanFeatures(planKey).has(feature);

module.exports = {
  PLANS,
  FEATURE_TREE,
  resolvePlanFeatures,
  isFeatureInPlan,
};