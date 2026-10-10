const { getEntitlements, norm } = require("../services/entitlements");

const deny = (res, status, code, message, extra = {}) =>
  res.status(status).json({ success: false, code, message, ...extra });

const requireFeature = (featureCode) => async (req, res, next) => {
  try {
    if (!req.user?.tenantId) {
      return deny(res, 403, "TENANT_REQUIRED", "Tenant access required");
    }

    const ent = await getEntitlements(req.user.tenantId);

    if (!ent.valid) {
      return deny(
        res,
        402,
        ent.reason || "SUBSCRIPTION_EXPIRED",
        "Subscription is inactive or expired"
      );
    }

    const feature = norm(featureCode);
    if (!ent.features.has(feature)) {
      return deny(
        res,
        403,
        "FEATURE_NOT_IN_PLAN",
        "Feature is not included in your subscription",
        { feature, plan: ent.plan }
      );
    }

    req.entitlements = ent;
    next();
  } catch (error) {
    console.error("Feature access error:", error);
    return deny(res, 500, "ENTITLEMENT_ERROR", "Failed to verify feature access");
  }
};

const requireLimit = (limitKey, counter) => async (req, res, next) => {
  try {
    const ent = req.entitlements || (await getEntitlements(req.user.tenantId));
    const max = ent.limits?.[limitKey];

    if (max !== undefined && max !== null) {
      const used = await counter(req.user.tenantId, req);
      if (used >= max) {
        return deny(
          res,
          402,
          "LIMIT_REACHED",
          `Your plan allows a maximum of ${max} ${limitKey}`,
          { limit: limitKey, max, used }
        );
      }
    }
    next();
  } catch (error) {
    console.error("Limit check error:", error);
    return deny(res, 500, "LIMIT_ERROR", "Failed to verify plan limits");
  }
};

module.exports = requireFeature;
module.exports.requireLimit = requireLimit;