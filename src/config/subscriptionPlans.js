const { MODULES, unique } = require("./accessModel");

const FEATURE_TREE = Object.fromEntries(
  Object.entries(MODULES).map(([key, module]) => [
    key,
    unique([...module.features, ...module.permissions]),
  ]),
);

/**
 * SINGLE SOURCE OF TRUTH FOR ALL SUBSCRIPTION PLANS
 * All prices, durations, limits, highlights and features are managed here.
 * The frontend pulls directly from here via /api/billing/plans.
 */
const PLANS = {
  trial: {
    id: "trial",
    name: "14-Day Free Trial",
    badge: "Free Starter",
    durationDays: 14,
    pricing: {
      monthly: 0,
      yearly: 0,
    },
    popular: false,
    description: "Full access to test all core invoicing and billing features",
    includedUsers: 3,
    extraUserPrice: 0,
    inherits: [],
    highlights: [
      "1 Business Profile",
      "1 Branch / Location",
      "Up to 3 Users",
      "50 Invoices / Month",
      "Full Sales & Invoicing",
    ],
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
      businesses: 1,
      branches: 1,
    },
  },

  basic: {
    id: "basic",
    name: "Basic Plan",
    badge: "Essential",
    durationDays: 365,
    pricing: {
      monthly: 299,
      yearly: 2499,
    },
    popular: false,
    description: "Best for sole proprietors and single-outlet retail shops",
    includedUsers: 3,
    extraUserPrice: 199,
    inherits: [],
    highlights: [
      "1 Business Profile",
      "1 Branch / Location",
      "Up to 3 Staff Users",
      "1,000 Invoices / Year",
      "GST Invoicing & Reports",
      "Customer & Supplier Ledgers",
    ],
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
      businesses: 1,
      branches: 1,
    },
  },

  standard: {
    id: "standard",
    name: "Standard Plan",
    badge: "Most Popular",
    durationDays: 365,
    pricing: {
      monthly: 599,
      yearly: 4999,
    },
    popular: true,
    description: "Ideal for growing distributors, traders & multi-branch businesses",
    includedUsers: 10,
    extraUserPrice: 249,
    inherits: ["basic"],
    highlights: [
      "Up to 3 Businesses (Companies)",
      "Up to 5 Branches & Warehouses",
      "1-Click Business & Branch Switching",
      "Up to 10 Users with Role Permissions",
      "5,000 Invoices / Year",
      "E-Way Bill & E-Invoicing",
      "Audit Trail & WhatsApp Notifications",
    ],
    features: [
      "production",
      "assets",
      "crm",
      "gst.eInvoice",
      "gst.eWayBill",
      "settings.auditLogs",
      "multi-business",
      "multi-branch",
    ],
    limits: {
      users: 10,
      invoices: 5000,
      products: 5000,
      storageMb: 10000,
      businesses: 3,
      branches: 5,
    },
  },

  premium: {
    id: "premium",
    name: "Premium Enterprise",
    badge: "All Unlimited",
    durationDays: 365,
    pricing: {
      monthly: 999,
      yearly: 8999,
    },
    popular: false,
    description: "For enterprises requiring unlimited businesses, branches & scale",
    includedUsers: 25,
    extraUserPrice: 299,
    inherits: ["standard"],
    highlights: [
      "Unlimited Businesses (Companies)",
      "Unlimited Branches & Warehouses",
      "Unlimited Invoices & Inventory Items",
      "Up to 25 Users",
      "Production & Manufacturing",
      "Assets & Quality Control",
      "Dedicated Priority Support",
    ],
    features: [
      "projects",
      "quality",
      "hr",
      "settings.api",
      "multi-business",
      "multi-branch",
    ],
    limits: {
      users: 25,
      invoices: null,
      products: null,
      storageMb: 50000,
      businesses: null,
      branches: null,
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
