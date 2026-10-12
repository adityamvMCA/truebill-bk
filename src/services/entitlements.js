const {
  PLANS,
  FEATURE_TREE,
} = require("../config/subscriptionPlans");

const normalizeFeatures = (features) => {
  if (!features) {
    return [];
  }

  if (Array.isArray(features)) {
    return features
      .filter(
        (feature) =>
          typeof feature === "string" &&
          feature.trim() !== "",
      )
      .map((feature) => feature.trim());
  }

  if (typeof features === "string") {
    return features
      .split(",")
      .map((feature) => feature.trim())
      .filter(Boolean);
  }

  return [];
};

const normalizeLimits = (limits) => {
  if (!limits) {
    return {};
  }

  if (limits instanceof Map) {
    return Object.fromEntries(limits);
  }

  if (Array.isArray(limits)) {
    return Object.fromEntries(limits);
  }

  if (typeof limits === "object") {
    return { ...limits };
  }

  return {};
};

const getPlanChain = (planCode) => {
  const chain = [];

  const visited = new Set();

  let currentCode = planCode;

  while (
    currentCode &&
    PLANS[currentCode] &&
    !visited.has(currentCode)
  ) {
    visited.add(currentCode);

    chain.push(currentCode);

    currentCode =
      PLANS[currentCode].inherits?.[0];
  }

  return chain;
};

const getPlanFeatures = (planCode) => {
  const plan = PLANS[planCode];

  if (!plan) {
    return [];
  }

  return normalizeFeatures(plan.features);
};

const getPlanLimits = (planCode) => {
  const plan = PLANS[planCode];

  if (!plan) {
    return {};
  }

  return plan.limits || {};
};

const getEntitlements = async (tenant) => {
  try {
    if (!tenant) {
      throw new Error(
        "Tenant is required to resolve entitlements",
      );
    }

    const planCode = String(
      tenant.subscriptionPlan || "trial",
    )
      .trim()
      .toLowerCase();

    const plan = PLANS[planCode];

    if (!plan) {
      throw new Error(
        `Invalid subscription plan: ${planCode}`,
      );
    }

    const planChain =
      getPlanChain(planCode);

    const effectiveFeatures = new Set();

    for (const currentPlanCode of planChain) {
      const currentPlanFeatures =
        getPlanFeatures(currentPlanCode);

      for (const feature of currentPlanFeatures) {
        effectiveFeatures.add(feature);
      }
    }

    const tenantFeatures =
      normalizeFeatures(tenant.features);

    for (const feature of tenantFeatures) {
      effectiveFeatures.add(feature);
    }

    const effectiveLimits = {};

    for (const currentPlanCode of planChain) {
      const currentPlanLimits =
        getPlanLimits(currentPlanCode);

      Object.assign(
        effectiveLimits,
        currentPlanLimits,
      );
    }

    const tenantLimits = normalizeLimits(
      tenant.limits,
    );

    Object.assign(
      effectiveLimits,
      tenantLimits,
    );

    const features = Array.from(
      effectiveFeatures,
    ).sort();

    return {
      plan: planCode,
      planName: plan.name,
      planChain,
      features,
      limits: effectiveLimits,
      includedUsers: plan.includedUsers,
      extraUserPrice: plan.extraUserPrice,
      subscriptionStart:
        tenant.subscriptionStart || null,
      subscriptionEnd:
        tenant.subscriptionEnd || null,
      status: tenant.status || "trial",
      isActive: tenant.isActive !== false,
    };
  } catch (error) {
    console.error(
      "Get entitlements error:",
      error,
    );

    throw error;
  }
};

const serializeEntitlements = (
  entitlements,
) => {
  if (!entitlements) {
    return null;
  }

  return {
    plan: entitlements.plan,
    planName: entitlements.planName,
    planChain: entitlements.planChain,
    features: entitlements.features,
    limits: entitlements.limits,
    includedUsers:
      entitlements.includedUsers,
    extraUserPrice:
      entitlements.extraUserPrice,
    subscriptionStart:
      entitlements.subscriptionStart,
    subscriptionEnd:
      entitlements.subscriptionEnd,
    status: entitlements.status,
    isActive: entitlements.isActive,
  };
};

const hasFeature = (
  entitlements,
  feature,
) => {
  if (!entitlements?.features) {
    return false;
  }

  if (!feature) {
    return false;
  }

  return entitlements.features.includes(
    feature,
  );
};

const getLimit = (
  entitlements,
  limitKey,
) => {
  if (!entitlements?.limits) {
    return undefined;
  }

  if (!limitKey) {
    return undefined;
  }

  return entitlements.limits[limitKey];
};

const isWithinLimit = (
  entitlements,
  limitKey,
  usedCount,
) => {
  const limit = getLimit(
    entitlements,
    limitKey,
  );

  if (
    limit === null ||
    limit === undefined
  ) {
    return true;
  }

  const numericLimit = Number(limit);

  if (
    !Number.isFinite(numericLimit) ||
    numericLimit < 0
  ) {
    return true;
  }

  return (
    Number(usedCount || 0) < numericLimit
  );
};

const getFeatureTree = () => FEATURE_TREE;

module.exports = {
  getEntitlements,
  serializeEntitlements,
  hasFeature,
  getLimit,
  isWithinLimit,
  getFeatureTree,
  normalizeFeatures,
  normalizeLimits,
};