const { getEntitlements, norm } = require("../services/entitlements");

const deny = (res, status, code, message, extra = {}) =>
  res.status(status).json({
    success: false,
    code,
    message,
    ...extra,
  });

const requireFeature = (featureCode) => async (req, res, next) => {
  try {
    if (!req.user?.tenantId) {
      return deny(
        res,
        403,
        "TENANT_REQUIRED",
        "Tenant access required",
      );
    }

    const entitlements = await getEntitlements(req.user.tenantId);

    if (!entitlements.valid) {
      return deny(
        res,
        402,
        entitlements.reason || "SUBSCRIPTION_EXPIRED",
        "Subscription is inactive or expired",
      );
    }

    const feature = norm(featureCode);

    if (!entitlements.features.includes(feature)) {
      return deny(
        res,
        403,
        "FEATURE_NOT_IN_PLAN",
        "This feature is not included in your subscription",
        {
          feature,
          plan: entitlements.plan,
        },
      );
    }

    req.entitlements = entitlements;

    next();
  } catch (error) {
    console.error("Feature access error:", error);

    return deny(
      res,
      500,
      "ENTITLEMENT_ERROR",
      "Failed to verify feature access",
    );
  }
};

const requireLimit = (limitKey, counter) => async (req, res, next) => {
  try {
    const entitlements =
      req.entitlements ||
      (await getEntitlements(req.user.tenantId));

    const max = entitlements.limits?.[limitKey];

    if (max !== undefined && max !== null) {
      const used = await counter(req.user.tenantId, req);

      if (used >= max) {
        return deny(
          res,
          402,
          "LIMIT_REACHED",
          `Your plan allows a maximum of ${max} ${limitKey}`,
          {
            limit: limitKey,
            max,
            used,
          },
        );
      }
    }

    next();
  } catch (error) {
    console.error("Limit check error:", error);

    return deny(
      res,
      500,
      "LIMIT_ERROR",
      "Failed to verify plan limit",
    );
  }
};

module.exports = requireFeature;
module.exports.requireLimit = requireLimit;