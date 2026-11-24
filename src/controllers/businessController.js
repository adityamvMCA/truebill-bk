const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Branch = require("../models/Branch");
const { getNextSequence } = require("../utils/sequenceGenerator");
const { getTenantDatabaseName } = require("../tenancy/tenantDatabaseNames");
const { provisionTenantDatabase } = require("../tenancy/provisionTenantDatabase");
const { getEntitlements } = require("../services/entitlements");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const buildUpgradeBanner = ({ limitType, currentPlan, max, used }) => {
  const isBusiness = limitType === "businesses";
  return {
    badge: "PRO FEATURE",
    title: isBusiness
      ? "Unlock Multiple Businesses & Companies"
      : "Expand with Multi-Branch Support",
    subtitle: isBusiness
      ? "Run multiple firms under one account just like MyBillBook & Vyapar"
      : "Track sales, inventory & staff across all your locations",
    description: isBusiness
      ? `Your ${currentPlan.toUpperCase()} plan allows ${max} business (${used} used). Upgrade to TrueBill Standard for up to 3 businesses or Premium for unlimited businesses.`
      : `Your ${currentPlan.toUpperCase()} plan allows ${max} branch (${used} used). Upgrade to TrueBill Standard for up to 5 branches or Premium for unlimited branches.`,
    highlights: isBusiness
      ? [
          "1-Click company switching without logging out",
          "Separate GSTIN, invoice numbering, and print templates",
          "Independent ledgers, inventory, and profit & loss",
          "Consolidated reports across all your businesses",
        ]
      : [
          "Multi-branch sales, purchases, and daybooks",
          "Stock transfers between godowns and branch stores",
          "Custom branch addresses and contacts on invoices",
          "Branch-level staff permissions and collections",
        ],
    actionText: "Upgrade to Pro",
    actionUrl: "/billing/renew",
    plans: [
      {
        name: "Standard",
        price: "₹4,999/yr",
        businesses: "3 Businesses",
        branches: "5 Branches",
      },
      {
        name: "Premium",
        price: "₹8,999/yr",
        businesses: "Unlimited Businesses",
        branches: "Unlimited Branches",
      },
    ],
  };
};

/* ================================================================
   GET MY BUSINESSES
================================================================ */
const getMyBusinesses = async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id || req.user.id;
    const isPlatform = ["developer", "support"].includes(req.user.platformRole);

    let accessibleTenantIds = new Set();

    if (req.user.tenantId) {
      accessibleTenantIds.add(String(req.user.tenantId));
    }

    if (req.tenantId) {
      accessibleTenantIds.add(String(req.tenantId));
    }

    const dbUser = await User.findById(userId).lean();
    if (dbUser?.tenantId) {
      accessibleTenantIds.add(String(dbUser.tenantId));
    }
    if (Array.isArray(dbUser?.tenants)) {
      dbUser.tenants.forEach((t) => {
        if (t?.tenantId) accessibleTenantIds.add(String(t.tenantId));
      });
    }

    // Also include any tenants created by this user
    const createdTenants = await Tenant.find({
      createdBy: userId,
      isActive: true,
    })
      .select("_id")
      .lean();

    createdTenants.forEach((t) => accessibleTenantIds.add(String(t._id)));

    let query = {
      _id: { $in: Array.from(accessibleTenantIds) },
      isActive: true,
    };

    if (isPlatform && accessibleTenantIds.size === 0) {
      query = { isActive: true };
    }

    const businesses = await Tenant.find(query)
      .select("businessName businessType clientCode email phone gstNo city state status subscriptionPlan subscriptionEnd createdBy")
      .sort({ businessName: 1 })
      .lean();

    // Check plan limits
    const activeTenant = businesses.find(
      (b) => String(b._id) === String(req.tenantId || req.user.tenantId)
    ) || businesses[0];
    const plan = (activeTenant?.subscriptionPlan || "basic").toLowerCase();
    const maxBusinesses = plan === "premium" ? null : plan === "standard" ? 3 : 1;

    const currentId = String(req.tenantId || req.user.tenantId || "");
    const totalCount = businesses.length;
    const canCreate = maxBusinesses === null || totalCount < maxBusinesses;

    return res.json({
      success: true,
      activeTenantId: currentId,
      businesses: businesses.map((b) => ({
        id: b._id,
        _id: b._id,
        businessName: b.businessName,
        businessType: b.businessType,
        clientCode: b.clientCode,
        gstNo: b.gstNo,
        phone: b.phone,
        email: b.email,
        city: b.city,
        state: b.state,
        status: b.status || "active",
        isActive: b.isActive !== false,
        subscriptionPlan: b.subscriptionPlan || "basic",
        subscriptionEnd: b.subscriptionEnd,
        isCurrent: String(b._id) === currentId,
        isOwner: String(b.createdBy || "") === String(userId),
      })),
      limits: {
        plan,
        max: maxBusinesses,
        used: totalCount,
        canCreate,
      },
    });
  } catch (error) {
    console.error("getMyBusinesses error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load businesses",
    });
  }
};

/* ================================================================
   CREATE MY BUSINESS (Multi-business with Plan Limit Check)
================================================================ */
const createMyBusiness = async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id || req.user.id;
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
    } = req.body || {};

    if (!businessName || !String(businessName).trim()) {
      return res.status(400).json({
        success: false,
        message: "Business name is required",
      });
    }

    // 1. Plan Limit Check: Count businesses created or owned by this user
    let userTenantIds = new Set();
    const dbUser = await User.findById(userId).lean();
    if (dbUser?.tenantId) userTenantIds.add(String(dbUser.tenantId));
    if (Array.isArray(dbUser?.tenants)) {
      dbUser.tenants.forEach((t) => {
        if (t?.tenantId) userTenantIds.add(String(t.tenantId));
      });
    }

    const existingOwned = await Tenant.find({
      $or: [
        { _id: { $in: Array.from(userTenantIds) } },
        { createdBy: userId },
      ],
      isActive: true,
    }).lean();

    const usedCount = existingOwned.length;

    // Check primary plan
    const primaryTenant = existingOwned[0] || (req.tenantId ? await Tenant.findById(req.tenantId).lean() : null);
    const plan = (primaryTenant?.subscriptionPlan || "basic").toLowerCase();
    const maxAllowed = plan === "premium" ? null : plan === "standard" ? 3 : 1;
    const subscriptionEnd = primaryTenant?.subscriptionEnd || null;

    // If limit is reached, return 402 with UPGRADE AD BANNER!
    if (maxAllowed !== null && usedCount >= maxAllowed) {
      const banner = buildUpgradeBanner({
        limitType: "businesses",
        currentPlan: plan,
        max: maxAllowed,
        used: usedCount,
      });

      return res.status(402).json({
        success: false,
        code: "PLAN_LIMIT_REACHED",
        upgradeRequired: true,
        currentPlan: plan,
        requiredPlan: "standard",
        limit: "businesses",
        max: maxAllowed,
        used: usedCount,
        message: `${plan.toUpperCase()} plan allows a maximum of ${maxAllowed} business. Upgrade to TrueBill Standard or Premium to add multiple businesses.`,
        banner,
      });
    }

    // 2. Allowed to create -> Generate client code & keys
    const clientCode = await getNextSequence("TRD", "PLATFORM");
    const databaseKey = clientCode.trim().toLowerCase();
    const databaseName = getTenantDatabaseName(databaseKey);

    const dedicatedEnabled = process.env.TENANT_DATABASES_ENABLED === "true";

    const newTenant = await Tenant.create({
      clientCode,
      businessName: String(businessName).trim(),
      businessType: String(businessType || "Trader").trim(),
      email: email && EMAIL_REGEX.test(email) ? email.trim().toLowerCase() : undefined,
      phone: phone ? String(phone).replace(/\D/g, "").slice(-10) : undefined,
      gstNo: gstNo ? String(gstNo).trim().toUpperCase() : undefined,
      panNo: panNo ? String(panNo).trim().toUpperCase() : undefined,
      address: address ? String(address).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      state: state ? String(state).trim() : undefined,
      pincode: pincode ? String(pincode).trim() : undefined,
      subscriptionPlan: plan,
      subscriptionStart: new Date(),
      subscriptionEnd: subscriptionEnd || new Date(Date.now() + 365 * 86400000),
      status: "active",
      isActive: true,
      createdBy: userId,
      databaseKey,
      databaseName,
      storageMode: dedicatedEnabled ? "DEDICATED" : "LEGACY",
      provisioningStatus: dedicatedEnabled ? "PROVISIONING" : "LEGACY",
    });

    if (dedicatedEnabled) {
      try {
        await provisionTenantDatabase({
          tenant: newTenant,
          userId,
        });
        await Tenant.updateOne(
          { _id: newTenant._id },
          {
            provisioningStatus: "READY",
            databaseSchemaVersion: 1,
            provisionedAt: new Date(),
          }
        );
      } catch (err) {
        console.warn("Provisioning dedicated db warning:", err.message);
      }
    }

    // Link new tenant to the user
    await User.updateOne(
      { _id: userId },
      {
        $addToSet: {
          tenants: {
            tenantId: newTenant._id,
            role: "admin",
            isDefault: false,
            joinedAt: new Date(),
          },
        },
      }
    );

    // Auto-create default "Main Branch" for this new business
    try {
      await Branch.create({
        tenantId: newTenant._id,
        name: "Main Branch",
        code: "MAIN",
        isMain: true,
        phone: newTenant.phone || "",
        email: newTenant.email || "",
        gstNo: newTenant.gstNo || "",
        address: {
          street: newTenant.address || "",
          city: newTenant.city || "",
          state: newTenant.state || "",
          pincode: newTenant.pincode || "",
        },
        createdBy: userId,
      });
    } catch (bErr) {
      console.warn("Could not create default branch:", bErr.message);
    }

    return res.status(201).json({
      success: true,
      message: `${newTenant.businessName} created successfully!`,
      business: {
        id: newTenant._id,
        _id: newTenant._id,
        businessName: newTenant.businessName,
        clientCode: newTenant.clientCode,
        gstNo: newTenant.gstNo,
        status: newTenant.status,
        subscriptionPlan: newTenant.subscriptionPlan,
      },
    });
  } catch (error) {
    console.error("createMyBusiness error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create business",
    });
  }
};

/* ================================================================
   SWITCH BUSINESS
================================================================ */
const switchBusiness = async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id || req.user.id;
    const { tenantId } = req.body || {};

    if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Valid business ID (tenantId) is required",
      });
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      isActive: true,
    }).lean();

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Business not found or inactive",
      });
    }

    // Verify user authorization for this tenant
    const isPlatform = ["developer", "support"].includes(req.user.platformRole);
    const dbUser = await User.findById(userId).lean();

    let hasAccess = isPlatform || String(tenant.createdBy) === String(userId) || String(dbUser?.tenantId) === String(tenantId);
    if (!hasAccess && Array.isArray(dbUser?.tenants)) {
      hasAccess = dbUser.tenants.some((t) => String(t.tenantId) === String(tenantId));
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this business",
      });
    }

    // Update user active tenant
    await User.updateOne({ _id: userId }, { $set: { tenantId: tenant._id } });

    // Issue refreshed token
    const token = jwt.sign(
      {
        userId: dbUser._id,
        platformRole: dbUser.platformRole,
        role: dbUser.role,
        tenantId: tenant._id,
        clientCode: tenant.clientCode,
        developerCode: dbUser.developerCode || null,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "24h",
      }
    );

    return res.json({
      success: true,
      message: `Switched to ${tenant.businessName}`,
      token,
      tenant: {
        id: tenant._id,
        _id: tenant._id,
        businessName: tenant.businessName,
        clientCode: tenant.clientCode,
        status: tenant.status,
        subscriptionPlan: tenant.subscriptionPlan,
        subscriptionEnd: tenant.subscriptionEnd,
      },
    });
  } catch (error) {
    console.error("switchBusiness error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to switch business",
    });
  }
};

module.exports = {
  getMyBusinesses,
  createMyBusiness,
  switchBusiness,
  buildUpgradeBanner,
};
