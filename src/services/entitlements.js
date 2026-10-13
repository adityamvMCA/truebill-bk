// const {
//   PLANS,
//   FEATURE_TREE,
// } = require("../config/subscriptionPlans");

// const normalizeFeatures = (features) => {
//   if (!features) {
//     return [];
//   }

//   if (Array.isArray(features)) {
//     return features
//       .filter(
//         (feature) =>
//           typeof feature === "string" &&
//           feature.trim() !== "",
//       )
//       .map((feature) => feature.trim());
//   }

//   if (typeof features === "string") {
//     return features
//       .split(",")
//       .map((feature) => feature.trim())
//       .filter(Boolean);
//   }

//   return [];
// };

// const normalizeLimits = (limits) => {
//   if (!limits) {
//     return {};
//   }

//   if (limits instanceof Map) {
//     return Object.fromEntries(limits);
//   }

//   if (Array.isArray(limits)) {
//     return Object.fromEntries(limits);
//   }

//   if (typeof limits === "object") {
//     return { ...limits };
//   }

//   return {};
// };

// const getPlanChain = (planCode) => {
//   const chain = [];

//   const visited = new Set();

//   let currentCode = planCode;

//   while (
//     currentCode &&
//     PLANS[currentCode] &&
//     !visited.has(currentCode)
//   ) {
//     visited.add(currentCode);

//     chain.push(currentCode);

//     currentCode =
//       PLANS[currentCode].inherits?.[0];
//   }

//   return chain;
// };

// const getPlanFeatures = (planCode) => {
//   const plan = PLANS[planCode];

//   if (!plan) {
//     return [];
//   }

//   return normalizeFeatures(plan.features);
// };

// const getPlanLimits = (planCode) => {
//   const plan = PLANS[planCode];

//   if (!plan) {
//     return {};
//   }

//   return plan.limits || {};
// };

// const getEntitlements = async (tenant) => {
//   try {
//     if (!tenant) {
//       throw new Error(
//         "Tenant is required to resolve entitlements",
//       );
//     }

//     const planCode = String(
//       tenant.subscriptionPlan || "trial",
//     )
//       .trim()
//       .toLowerCase();

//     const plan = PLANS[planCode];

//     if (!plan) {
//       throw new Error(
//         `Invalid subscription plan: ${planCode}`,
//       );
//     }

//     const planChain =
//       getPlanChain(planCode);

//     const effectiveFeatures = new Set();

//     for (const currentPlanCode of planChain) {
//       const currentPlanFeatures =
//         getPlanFeatures(currentPlanCode);

//       for (const feature of currentPlanFeatures) {
//         effectiveFeatures.add(feature);
//       }
//     }

//     const tenantFeatures =
//       normalizeFeatures(tenant.features);

//     for (const feature of tenantFeatures) {
//       effectiveFeatures.add(feature);
//     }

//     const effectiveLimits = {};

//     for (const currentPlanCode of planChain) {
//       const currentPlanLimits =
//         getPlanLimits(currentPlanCode);

//       Object.assign(
//         effectiveLimits,
//         currentPlanLimits,
//       );
//     }

//     const tenantLimits = normalizeLimits(
//       tenant.limits,
//     );

//     Object.assign(
//       effectiveLimits,
//       tenantLimits,
//     );

//     const features = Array.from(
//       effectiveFeatures,
//     ).sort();

//     return {
//       plan: planCode,
//       planName: plan.name,
//       planChain,
//       features,
//       limits: effectiveLimits,
//       includedUsers: plan.includedUsers,
//       extraUserPrice: plan.extraUserPrice,
//       subscriptionStart:
//         tenant.subscriptionStart || null,
//       subscriptionEnd:
//         tenant.subscriptionEnd || null,
//       status: tenant.status || "trial",
//       isActive: tenant.isActive !== false,
//     };
//   } catch (error) {
//     console.error(
//       "Get entitlements error:",
//       error,
//     );

//     throw error;
//   }
// };

// const serializeEntitlements = (
//   entitlements,
// ) => {
//   if (!entitlements) {
//     return null;
//   }

//   return {
//     plan: entitlements.plan,
//     planName: entitlements.planName,
//     planChain: entitlements.planChain,
//     features: entitlements.features,
//     limits: entitlements.limits,
//     includedUsers:
//       entitlements.includedUsers,
//     extraUserPrice:
//       entitlements.extraUserPrice,
//     subscriptionStart:
//       entitlements.subscriptionStart,
//     subscriptionEnd:
//       entitlements.subscriptionEnd,
//     status: entitlements.status,
//     isActive: entitlements.isActive,
//   };
// };

// const hasFeature = (
//   entitlements,
//   feature,
// ) => {
//   if (!entitlements?.features) {
//     return false;
//   }

//   if (!feature) {
//     return false;
//   }

//   return entitlements.features.includes(
//     feature,
//   );
// };

// const getLimit = (
//   entitlements,
//   limitKey,
// ) => {
//   if (!entitlements?.limits) {
//     return undefined;
//   }

//   if (!limitKey) {
//     return undefined;
//   }

//   return entitlements.limits[limitKey];
// };

// const isWithinLimit = (
//   entitlements,
//   limitKey,
//   usedCount,
// ) => {
//   const limit = getLimit(
//     entitlements,
//     limitKey,
//   );

//   if (
//     limit === null ||
//     limit === undefined
//   ) {
//     return true;
//   }

//   const numericLimit = Number(limit);

//   if (
//     !Number.isFinite(numericLimit) ||
//     numericLimit < 0
//   ) {
//     return true;
//   }

//   return (
//     Number(usedCount || 0) < numericLimit
//   );
// };

// const getFeatureTree = () => FEATURE_TREE;

// module.exports = {
//   getEntitlements,
//   serializeEntitlements,
//   hasFeature,
//   getLimit,
//   isWithinLimit,
//   getFeatureTree,
//   normalizeFeatures,
//   normalizeLimits,
// };



const mongoose = require("mongoose");
const Tenant = require("../models/Tenant");

const {
  PLANS,
  FEATURE_TREE,
} = require("../config/subscriptionPlans");

const DAY_MS = 24 * 60 * 60 * 1000;

const norm = (value) =>
  String(value ?? "").trim().toLowerCase();

const owns = (object, key) =>
  Object.prototype.hasOwnProperty.call(
    object,
    key,
  );

const normalizeFeatures = (features) => {
  let values = [];

  if (features instanceof Set) {
    values = [...features];
  } else if (Array.isArray(features)) {
    values = features;
  } else if (typeof features === "string") {
    values = features.split(",");
  }

  return [
    ...new Set(
      values
        .filter(
          (value) =>
            typeof value === "string",
        )
        .map(norm)
        .filter(Boolean),
    ),
  ];
};

const normalizeLimits = (limits) => {
  if (
    limits === undefined ||
    limits === null
  ) {
    return {};
  }

  let source;

  if (limits instanceof Map) {
    source = Object.fromEntries(limits);
  } else if (Array.isArray(limits)) {
    if (
      !limits.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string",
      )
    ) {
      throw new Error(
        "Invalid tenant limit entries",
      );
    }

    source = Object.fromEntries(limits);
  } else if (typeof limits === "object") {
    source = limits;
  } else {
    throw new Error(
      "Tenant limits must be an object or Map",
    );
  }

  const result = {};

  for (const [
    key,
    value,
  ] of Object.entries(source)) {
    if (
      !key ||
      [
        "__proto__",
        "constructor",
        "prototype",
      ].includes(key)
    ) {
      throw new Error(
        "Invalid limit key",
      );
    }

    if (value === undefined) {
      continue;
    }

    if (value === null) {
      result[key] = null;
      continue;
    }

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new Error(
        `Invalid limit value for "${key}"`,
      );
    }

    result[key] = value;
  }

  return result;
};

const normalizedFeatureTree = new Map(
  Object.entries(FEATURE_TREE).map(
    ([parent, children]) => [
      norm(parent),
      normalizeFeatures(children),
    ],
  ),
);

const getPlanChain = (planCode) => {
  const chain = [];
  const visited = new Set();
  const visiting = new Set();

  const visit = (code) => {
    const normalizedCode = norm(code);

    if (!owns(PLANS, normalizedCode)) {
      throw new Error(
        `Invalid subscription plan: ${normalizedCode}`,
      );
    }

    if (visiting.has(normalizedCode)) {
      throw new Error(
        `Circular plan inheritance: ${normalizedCode}`,
      );
    }

    if (visited.has(normalizedCode)) {
      return;
    }

    visiting.add(normalizedCode);

    const parents =
      PLANS[normalizedCode].inherits || [];

    if (!Array.isArray(parents)) {
      throw new Error(
        `Invalid inheritance configuration: ${normalizedCode}`,
      );
    }

    for (const parent of parents) {
      visit(parent);
    }

    visiting.delete(normalizedCode);
    visited.add(normalizedCode);

    chain.push(normalizedCode);
  };

  visit(planCode);

  return chain;
};

const expandFeatures = (features) => {
  const expanded = new Set();

  const visit = (feature) => {
    const key = norm(feature);

    if (!key || expanded.has(key)) {
      return;
    }

    expanded.add(key);

    const children =
      normalizedFeatureTree.get(key) || [];

    for (const child of children) {
      visit(child);
    }
  };

  for (const feature of normalizeFeatures(
    features,
  )) {
    visit(feature);
  }

  return expanded;
};

const resolveTenant = async (
  tenantOrId,
) => {
  if (!tenantOrId) {
    throw new Error(
      "Tenant is required",
    );
  }

  const isTenantId =
    typeof tenantOrId === "string" ||
    tenantOrId instanceof
      mongoose.Types.ObjectId;

  if (isTenantId) {
    if (
      !mongoose.isValidObjectId(
        tenantOrId,
      )
    ) {
      throw new Error(
        "Invalid tenant id",
      );
    }

    const tenant =
      await Tenant.findById(tenantOrId)
        .select(
          "businessName clientCode status isActive subscriptionPlan subscriptionStart subscriptionEnd features limits",
        )
        .lean();

    if (!tenant) {
      throw new Error(
        "Tenant not found",
      );
    }

    return tenant;
  }

  if (typeof tenantOrId !== "object") {
    throw new Error(
      "Invalid tenant input",
    );
  }

  if (!tenantOrId.subscriptionPlan) {
    throw new Error(
      "Tenant subscriptionPlan is missing",
    );
  }

  return tenantOrId;
};

const getSubscriptionState = (tenant) => {
  const now = Date.now();

  const status = norm(
    tenant.status || "trial",
  );

  const hasEnd =
    tenant.subscriptionEnd !==
      undefined &&
    tenant.subscriptionEnd !== null;

  const endTime = hasEnd
    ? new Date(
        tenant.subscriptionEnd,
      ).getTime()
    : null;

  const daysLeft =
    endTime !== null &&
    Number.isFinite(endTime)
      ? Math.max(
          0,
          Math.ceil(
            (endTime - now) / DAY_MS,
          ),
        )
      : null;

  let reason = null;

  if (tenant.isActive === false) {
    reason = "TENANT_INACTIVE";
  } else if (
    !["trial", "active"].includes(
      status,
    )
  ) {
    reason = `SUBSCRIPTION_${status.toUpperCase()}`;
  } else if (
    hasEnd &&
    !Number.isFinite(endTime)
  ) {
    reason = "INVALID_SUBSCRIPTION_END";
  } else if (
    endTime !== null &&
    endTime <= now
  ) {
    reason = "SUBSCRIPTION_EXPIRED";
  }

  return {
    valid: reason === null,
    reason,
    status,
    daysLeft,
    inGrace: false,
  };
};

const getEntitlements = async (
  tenantOrId,
) => {
  const tenant = await resolveTenant(
    tenantOrId,
  );

  const planCode = norm(
    tenant.subscriptionPlan,
  );

  if (!owns(PLANS, planCode)) {
    throw new Error(
      `Invalid subscription plan: ${planCode}`,
    );
  }

  const plan = PLANS[planCode];

  const planChain = getPlanChain(
    planCode,
  );

  const rawFeatures = new Set();

  const limits = {};

  for (const currentPlanCode of planChain) {
    const currentPlan =
      PLANS[currentPlanCode];

    for (const feature of normalizeFeatures(
      currentPlan.features,
    )) {
      rawFeatures.add(feature);
    }

    Object.assign(
      limits,
      normalizeLimits(
        currentPlan.limits,
      ),
    );
  }

  for (const feature of normalizeFeatures(
    tenant.features,
  )) {
    rawFeatures.add(feature);
  }

  Object.assign(
    limits,
    normalizeLimits(tenant.limits),
  );

  return {
    tenantId:
      tenant._id || tenant.id || null,
    clientCode:
      tenant.clientCode || null,

    plan: planCode,
    planName: plan.name,
    planChain,

    features: expandFeatures(
      rawFeatures,
    ),

    limits,

    includedUsers: plan.includedUsers,
    extraUserPrice:
      plan.extraUserPrice,

    subscriptionStart:
      tenant.subscriptionStart || null,
    subscriptionEnd:
      tenant.subscriptionEnd || null,

    isActive:
      tenant.isActive !== false,

    ...getSubscriptionState(tenant),
  };
};

const serializeEntitlements = (
  entitlements,
) => {
  if (!entitlements) {
    return null;
  }

  return {
    tenantId:
      entitlements.tenantId,
    clientCode:
      entitlements.clientCode,

    plan: entitlements.plan,
    planName:
      entitlements.planName,
    planChain:
      entitlements.planChain,

    features:
      normalizeFeatures(
        entitlements.features,
      ).sort(),

    limits: normalizeLimits(
      entitlements.limits,
    ),

    includedUsers:
      entitlements.includedUsers,
    extraUserPrice:
      entitlements.extraUserPrice,

    subscriptionStart:
      entitlements.subscriptionStart,
    subscriptionEnd:
      entitlements.subscriptionEnd,

    status: entitlements.status,
    isActive:
      entitlements.isActive,
    valid: entitlements.valid,
    reason: entitlements.reason,
    daysLeft:
      entitlements.daysLeft,
    inGrace:
      entitlements.inGrace,
  };
};

const hasFeature = (
  entitlements,
  feature,
) => {
  if (
    !entitlements ||
    entitlements.valid === false
  ) {
    return false;
  }

  const key = norm(feature);

  if (!key) {
    return false;
  }

  if (
    entitlements.features instanceof Set
  ) {
    return entitlements.features.has(
      key,
    );
  }

  return normalizeFeatures(
    entitlements.features,
  ).includes(key);
};

const getLimit = (
  entitlements,
  limitKey,
) => {
  if (
    !entitlements?.limits ||
    !limitKey
  ) {
    return undefined;
  }

  if (
    entitlements.limits instanceof Map
  ) {
    return entitlements.limits.get(
      limitKey,
    );
  }

  return entitlements.limits[limitKey];
};

const isWithinLimit = (
  entitlements,
  limitKey,
  usedCount = 0,
) => {
  if (
    !entitlements ||
    entitlements.valid === false
  ) {
    return false;
  }

  const used = Number(usedCount);

  if (
    !Number.isFinite(used) ||
    used < 0
  ) {
    return false;
  }

  const limit = getLimit(
    entitlements,
    limitKey,
  );

  if (limit === null) {
    return true;
  }

  if (
    typeof limit !== "number" ||
    !Number.isFinite(limit) ||
    limit < 0
  ) {
    return false;
  }

  return used < limit;
};

const getFeatureTree = () =>
  FEATURE_TREE;

module.exports = {
  norm,
  normalizeFeatures,
  normalizeLimits,
  getPlanChain,
  expandFeatures,
  getEntitlements,
  serializeEntitlements,
  hasFeature,
  getLimit,
  isWithinLimit,
  getFeatureTree,
};