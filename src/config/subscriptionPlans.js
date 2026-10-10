const SUBSCRIPTION_PLANS = {
  basic: {
    name: "Basic",
    features: [
      "dashboard",
      "customers",
      "sales",
      "reports",
      "purchase"
    ],
    limits: {
      users: 2,
    },
  },

  professional: {
    name: "Professional",
    features: [
      "dashboard",
      "customers",
      "sales",
      "purchase",
      "inventory",
      "quotation",
      "reports",
    ],
    limits: {
      users: 10,
    },
  },

  enterprise: {
    name: "Enterprise",
    features: [
      "dashboard",
      "customers",
      "sales",
      "purchase",
      "inventory",
      "quotation",
      "comparison",
      "reports",
      "settings",
    ],
    limits: {
      users: 100,
    },
  },
};

module.exports = SUBSCRIPTION_PLANS;