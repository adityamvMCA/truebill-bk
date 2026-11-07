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