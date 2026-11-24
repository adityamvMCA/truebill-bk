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
    if (Array.isArray(user?.tenants)) {
      user.tenants.forEach((t) => t?.tenantId && ids.add(String(t.tenantId)));
    }
    const owned = await Tenant.find({ createdBy: userId, isActive: true })
      .select("_id")
      .lean();
    owned.forEach((t) => ids.add(String(t._id)));
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

const completeUserLogin = async (user, res) => {
  if (!user.isActive) {
    return fail(res, 403, "User account is inactive");
  }

  let tenant = null;
  let subscription = null;

  if (user.tenantId) {
    tenant = await getTenantForAuth(user.tenantId);

    if (!tenant || !tenant.isActive) {
      return fail(res, 403, "Tenant is inactive or unavailable");
    }

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

  const token = jwt.sign(
    {
      userId: user._id,
      platformRole: user.platformRole,
      role: user.role,
      tenantId: user.tenantId || null,
      clientCode: user.clientCode || null,
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
      },
    },
  );

  const businesses = await getAccessibleTenants(user._id, user.tenantId);

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

    if (!password || (!email && !username)) {
      return fail(res, 400, "Email/Username and password are required");
    }

    const queryConditions = [];

    if (email) {
      queryConditions.push({
        email: String(email).toLowerCase().trim(),
      });
    }

    if (username) {
      queryConditions.push({
        username: String(username).toLowerCase().trim(),
      });
    }

    const user = await User.findOne({
      $or: queryConditions,
    }).select("+password");

    const hash = user?.password || DUMMY_HASH;

    const passwordOk = await bcrypt.compare(String(password), hash);

    if (!user || !passwordOk) {
      return fail(res, 401, "Invalid credentials");
    }

    return completeUserLogin(user, res);
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
