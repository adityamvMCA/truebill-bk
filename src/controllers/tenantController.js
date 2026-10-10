const bcrypt = require("bcrypt");
const Tenant = require("../models/Tenant");
const User = require("../models/User");
const { getNextSequence } = require("../utils/sequenceGenerator");
const { getRolePermissions } = require("../utils/permissions");
const SUBSCRIPTION_PLANS = require("../config/subscriptionPlans");

const getTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    const result = await Promise.all(
      tenants.map(async (tenant) => ({
        ...tenant,
        userCount: await User.countDocuments({
          tenantId: tenant._id,
          isActive: true,
        }),
      })),
    );

    return res.json({
      success: true,
      total: result.length,
      tenants: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tenants",
    });
  }
};

const getTenantById = async (req, res) => {
  try {
    const tenant = await Tenant.findOne({
      _id: req.params.tenantId,
      isActive: true,
    }).lean();

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const userCount = await User.countDocuments({
      tenantId: tenant._id,
      isActive: true,
    });

    return res.json({
      success: true,
      tenant: { ...tenant, userCount },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tenant",
    });
  }
};

const createTenant = async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      email,
      phone,
      gstNo,
      panNo,
      address,
      city,
      state,
      pincode,
      subscriptionPlan,
      subscriptionEnd,
      adminName,
      adminEmail,
      adminPassword,
    } = req.body;

    if (
      !businessName?.trim() ||
      !adminName?.trim() ||
      !adminEmail?.trim() ||
      !adminPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "businessName, adminName, adminEmail and adminPassword are required",
      });
    }

    if (adminPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Admin password must be at least 6 characters",
      });
    }

    const normalizedEmail = adminEmail.toLowerCase().trim();

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({
        success: false,
        message: "Admin email already exists",
      });
    }

    const planCode = String(subscriptionPlan || "basic")
      .trim()
      .toLowerCase();

    const selectedPlan = SUBSCRIPTION_PLANS[planCode];

    if (!selectedPlan) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan",
      });
    }

    const startDate = new Date();
    const endDate = subscriptionEnd
      ? new Date(subscriptionEnd)
      : new Date(
          startDate.getTime() + selectedPlan.durationDays * 24 * 60 * 60 * 1000,
        );

    if (Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: "Subscription end date must be in the future",
      });
    }

    const clientCode = await getNextSequence("TRD", "PLATFORM");
    const password = await bcrypt.hash(adminPassword, 12);

    const tenant = await Tenant.create({
      clientCode,
      businessName: businessName.trim(),
      businessType: businessType || "Trader",
      email: email?.trim().toLowerCase(),
      phone,
      gstNo: gstNo?.trim().toUpperCase(),
      panNo: panNo?.trim().toUpperCase(),
      address,
      city,
      state,
      pincode,
      subscriptionPlan: planCode,
      subscriptionStart: startDate,
      subscriptionEnd: endDate,
      features: selectedPlan.features,
      status: "active",
      createdBy: req.user.userId,
    });

    try {
      const admin = await User.create({
        name: adminName.trim(),
        email: normalizedEmail,
        password,
        platformRole: "tenant",
        role: "admin",
        tenantId: tenant._id,
        clientCode,
        permissions: getRolePermissions("admin"),
      });

      return res.status(201).json({
        success: true,
        message: "Trader created successfully",
        tenant,
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          clientCode: admin.clientCode,
        },
      });
    } catch (error) {
      await Tenant.deleteOne({ _id: tenant._id });
      throw error;
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A duplicate record already exists",
      });
    }

    console.error("Create tenant error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create trader",
    });
  }
};

const createTenantUser = async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    const tenant = await Tenant.findOne({
      _id: req.params.tenantId,
      isActive: true,
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }

    if (
      tenant.status !== "active" ||
      (tenant.subscriptionEnd && tenant.subscriptionEnd <= new Date())
    ) {
      return res.status(403).json({
        success: false,
        message: "Tenant subscription is not active",
      });
    }

    const plan = SUBSCRIPTION_PLANS[tenant.subscriptionPlan];
    const userLimit = plan?.limits?.users;

    if (Number.isFinite(userLimit)) {
      const userCount = await User.countDocuments({
        tenantId: tenant._id,
        isActive: true,
      });

      if (userCount >= userLimit) {
        return res.status(403).json({
          success: false,
          message: "Your subscription user limit has been reached",
        });
      }
    }

    const normalizedRole = String(role || "viewer").toLowerCase();

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
      platformRole: "tenant",
      role: normalizedRole,
      tenantId: tenant._id,
      clientCode: tenant.clientCode,
      permissions: Array.isArray(permissions)
        ? permissions
        : getRolePermissions(normalizedRole),
    });

    return res.status(201).json({
      success: true,
      message: "Tenant user created successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        clientCode: user.clientCode,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    console.error("Create tenant user error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create tenant user",
    });
  }
};

module.exports = {
  getTenants,
  getTenantById,
  createTenant,
  createTenantUser,
};
