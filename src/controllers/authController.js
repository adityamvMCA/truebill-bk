const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Tenant = require("../models/Tenant");
const otpService = require("../services/otpService");

const { getRolePermissions } = require("../utils/permissions");

const {
  getEntitlements,
  serializeEntitlements,
} = require("../services/entitlements");

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({
    success: false,
    message,
    ...extra,
  });

const DUMMY_HASH =
  "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.Qe6Zc5Yw2cH3vC0v1o9m0o8m5q8a";

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone || null,
  username: user.username,
  platformRole: user.platformRole,
  role: user.role,
  tenantId: user.tenantId,
  clientCode: user.clientCode,
  developerCode: user.developerCode,
  permissions: user.permissions?.length
    ? user.permissions
    : getRolePermissions(user.role),
});

const getTenantForAuth = async (tenantId) => {
  return Tenant.findById(tenantId)
    .select(
      "businessName clientCode status isActive subscriptionPlan subscriptionStart subscriptionEnd features limits",
    )
    .lean();
};

const getAccessibleTenants = async (userId, userTenantId) => {
  try {
    const ids = new Set();
    if (userTenantId) ids.add(String(userTenantId));

    const user = await User.findById(userId).lean();
    if (user?.tenantId) ids.add(String(user.tenantId));
    if (user?.primaryTenantId) ids.add(String(user.primaryTenantId));

    if (Array.isArray(user?.tenants)) {
      user.tenants.forEach((t) => t?.tenantId && ids.add(String(t.tenantId)));
    }

    if (user?.clientCode) {
      const byCode = await Tenant.findOne({ clientCode: user.clientCode, isActive: true }).select("_id").lean();
      if (byCode) ids.add(String(byCode._id));
    }

    const owned = await Tenant.find({ createdBy: userId, isActive: true })
      .select("_id parentTenantId")
      .lean();
    owned.forEach((t) => {
      ids.add(String(t._id));
      if (t.parentTenantId) ids.add(String(t.parentTenantId));
    });

    if (ids.size > 0) {
      const familyTenants = await Tenant.find({
        $or: [
          { parentTenantId: { $in: Array.from(ids) } },
          { _id: { $in: Array.from(ids) } },
        ],
        isActive: true,
      })
        .select("_id parentTenantId")
        .lean();

      familyTenants.forEach((t) => {
        ids.add(String(t._id));
        if (t.parentTenantId) ids.add(String(t.parentTenantId));
      });
    }

    const list = await Tenant.find({ _id: { $in: Array.from(ids) }, isActive: true })
      .select("businessName businessType clientCode status subscriptionPlan subscriptionEnd")
      .sort({ businessName: 1 })
      .lean();
    return list.map((b) => ({
      id: b._id,
      _id: b._id,
      businessName: b.businessName,
      clientCode: b.clientCode,
      status: b.status,
      subscriptionPlan: b.subscriptionPlan,
    }));
  } catch {
    return [];
  }
};

const completeUserLogin = async (user, res, preferredTenantId = null) => {
  if (!user.isActive) {
    return fail(res, 403, "User account is inactive");
  }

  let activeTenantId = preferredTenantId || user.tenantId || user.primaryTenantId;
  let tenant = null;
  let subscription = null;

  if (activeTenantId) {
    tenant = await getTenantForAuth(activeTenantId);

    // If active tenant is inactive or not found, fallback to primaryTenantId
    if ((!tenant || !tenant.isActive) && user.primaryTenantId && String(user.primaryTenantId) !== String(activeTenantId)) {
      tenant = await getTenantForAuth(user.primaryTenantId);
      activeTenantId = user.primaryTenantId;
    }

    if (tenant && tenant.isActive) {
      try {
        const entitlements = await getEntitlements(tenant);
        subscription = serializeEntitlements(entitlements);
      } catch (err) {
        console.warn("Entitlements evaluation warning:", err.message);
      }
    }
  }

  const token = jwt.sign(
    {
      userId: user._id,
      platformRole: user.platformRole,
      role: user.role,
      tenantId: tenant ? tenant._id : (user.tenantId || null),
      clientCode: tenant ? tenant.clientCode : (user.clientCode || null),
      developerCode: user.developerCode || null,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "24h",
    },
  );

  await User.updateOne(
    {
      _id: user._id,
    },
    {
      $set: {
        lastLoginAt: new Date(),
        ...(tenant ? { tenantId: tenant._id } : {}),
      },
    },
  );

  const businesses = await getAccessibleTenants(user._id, tenant ? tenant._id : user.tenantId);

  return res.json({
    success: true,
    message: "Login successful",
    token,
    user: {
      ...publicUser(user),
      tenant: tenant
        ? {
            id: tenant._id,
            businessName: tenant.businessName,
            clientCode: tenant.clientCode,
            status: tenant.status,
            subscriptionPlan: tenant.subscriptionPlan,
            subscriptionEnd: tenant.subscriptionEnd,
          }
        : null,
      businesses,
    },
    subscription,
  });
};

const login = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const inputId = String(email || username || "").trim();

    if (!password || !inputId) {
      return fail(res, 400, "Email/Username/Client Code and password are required");
    }

    const lower = inputId.toLowerCase();
    const queryConditions = [
      { email: lower },
      { username: lower },
      { clientCode: inputId.toUpperCase() },
    ];

    const cleanDigits = inputId.replace(/\D/g, "");
    if (cleanDigits.length >= 10) {
      queryConditions.push({ phone: cleanDigits.slice(-10) });
    }

    // Check if input matches a tenant clientCode
    let preferredTenantId = null;
    const tenantByCode = await Tenant.findOne({
      clientCode: inputId.toUpperCase(),
      isActive: true,
    }).lean();

    if (tenantByCode) {
      preferredTenantId = tenantByCode._id;
      queryConditions.push({ tenantId: tenantByCode._id });
      queryConditions.push({ primaryTenantId: tenantByCode._id });
      queryConditions.push({ "tenants.tenantId": tenantByCode._id });
    }

    const user = await User.findOne({
      $or: queryConditions,
    }).select("+password");

    const hash = user?.password || DUMMY_HASH;

    const passwordOk = await bcrypt.compare(String(password), hash);

    if (!user || !passwordOk) {
      return fail(res, 401, "Invalid credentials");
    }

    return completeUserLogin(user, res, preferredTenantId);
  } catch (error) {
    console.error("Login error:", error);

    return fail(res, 500, "Login failed");
  }
};

const sendOtp = async (req, res) => {
  try {
    const { phone, userId } = req.body;

    if (!phone) {
      return fail(res, 400, "Registered mobile number is required");
    }

    const result = await otpService.requestOtp({ phone, userId });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("sendOtp error:", error);
    return fail(res, 400, error.message || "Failed to send OTP");
  }
};

const verifyOtpLogin = async (req, res) => {
  try {
    const { phone, otp, userId } = req.body;

    if (!otp) {
      return fail(res, 400, "OTP code is required");
    }

    const { valid, user } = await otpService.verifyOtp({ phone, otp, userId });

    if (!valid || !user) {
      return fail(res, 400, "Invalid verification request");
    }

    return completeUserLogin(user, res);
  } catch (error) {
    console.error("verifyOtpLogin error:", error);
    return fail(res, 400, error.message || "OTP verification failed");
  }
};

const me = async (req, res) => {
  try {
    let tenant = null;

    let subscription = null;

    const targetTenantId =
      req.headers["x-tenant-id"] ||
      req.headers["x-selected-tenant-id"] ||
      req.user.tenantId;

    if (targetTenantId) {
      tenant = await getTenantForAuth(targetTenantId);

      if (tenant) {
        const entitlements = await getEntitlements(tenant);

        if (!entitlements.valid) {
          return res.status(402).json({
            success: false,
            code: entitlements.reason,
            message: "Subscription is inactive or expired",
          });
        }

        subscription = serializeEntitlements(entitlements);
      }
    }

    const userId = req.user.userId || req.user._id || req.user.id;
    const businesses = await getAccessibleTenants(userId, targetTenantId);

    return res.json({
      success: true,
      user: {
        ...req.user,
        tenant: tenant
          ? {
              id: tenant._id,
              businessName: tenant.businessName,
              clientCode: tenant.clientCode,
              status: tenant.status,
              subscriptionPlan: tenant.subscriptionPlan,
              subscriptionEnd: tenant.subscriptionEnd,
            }
          : null,
        businesses,
      },
      subscription,
    });
  } catch (error) {
    console.error("Me error:", error);

    return fail(res, 500, "Failed to load profile");
  }
};

module.exports = {
  login,
  sendOtp,
  verifyOtpLogin,
  me,
};
