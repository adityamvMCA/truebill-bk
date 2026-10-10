const Tenant = require("../models/Tenant");
const SUBSCRIPTION_PLANS = require("../config/subscriptionPlans");

const TTL_MS = 60 * 1000;
const GRACE_DAYS = 3;
const DAY_MS = 86400000;
const cache = new Map();

const norm = (v) => String(v).trim().toLowerCase();

const buildEntitlements = (tenant) => {
  if (!tenant) {
    return {
      valid: false,
      inGrace: false,
      reason: "TENANT_NOT_FOUND",
      plan: null,
      status: null,
      daysLeft: null,
      subscriptionEnd: null,
      features: new Set(),
      limits: {},
    };
  }

  const planKey = norm(tenant.subscriptionPlan || "");
  const plan = SUBSCRIPTION_PLANS[planKey];

  const end = tenant.subscriptionEnd
    ? new Date(tenant.subscriptionEnd).getTime()
    : null;
  const now = Date.now();
  const graceEnd = end ? end + GRACE_DAYS * DAY_MS : Infinity;

  const statusOk = ["active", "trial", "past_due"].includes(tenant.status);
  const valid = statusOk && now < graceEnd;
  const inGrace = valid && end !== null && now >= end;

  const features = new Set(
    [
      ...(plan?.features || []),
      ...(tenant.addOns || []),
      ...(tenant.features || []),
    ].map(norm),
  );

  const limits = { ...(plan?.limits || {}), ...(tenant.limitOverrides || {}) };
  const daysLeft = end ? Math.ceil((end - now) / DAY_MS) : null;

  return {
    valid,
    inGrace,
    reason: valid ? null : "SUBSCRIPTION_EXPIRED",
    plan: planKey,
    status: tenant.status,
    daysLeft,
    subscriptionEnd: tenant.subscriptionEnd || null,
    features,
    limits,
  };
};

const getEntitlements = async (tenantId) => {
  const key = String(tenantId);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;

  const tenant = await Tenant.findOne({ _id: tenantId, isActive: true })
    .select(
      "status subscriptionEnd subscriptionPlan features addOns limitOverrides",
    )
    .lean();

  const value = buildEntitlements(tenant);
  cache.set(key, { value, exp: Date.now() + TTL_MS });
  return value;
};

const invalidateEntitlements = (tenantId) => cache.delete(String(tenantId));

const serializeEntitlements = (ent) =>
  ent && {
    valid: ent.valid,
    reason: ent.reason,
    plan: ent.plan,
    status: ent.status,
    daysLeft: ent.daysLeft,
    inGrace: !!ent.inGrace,
    subscriptionEnd: ent.subscriptionEnd,
    features: [...ent.features],
    limits: ent.limits,
  };

module.exports = {
  getEntitlements,
  invalidateEntitlements,
  serializeEntitlements,
  norm,
};