const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Tenant = require("../models/Tenant");
const User = require("../models/User");
const {
  seedDefaultLedgerGroups,
} = require("../modules/accounting/seeds/seedDefaultLedgerGroups");

const {
  seedDefaultLedgers,
} = require("../modules/accounting/seeds/seedDefaultLedgers");
const {
  getNextSequence,
} = require("../utils/sequenceGenerator");

const {
  getRolePermissions,
} = require("../utils/permissions");

const {
  PLANS: SUBSCRIPTION_PLANS,
} = require("../config/subscriptionPlans");

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHONE_REGEX =
  /^[6-9]\d{9}$/;

const PINCODE_REGEX =
  /^[1-9][0-9]{5}$/;

const GST_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const PAN_REGEX =
  /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const ALLOWED_ROLES = [
  "admin",
  "manager",
  "accountant",
  "sales",
  "purchase",
  "inventory",
  "viewer",
];

const normalizeOptionalText = (value) => {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return undefined;
  }

  return String(value).trim();
};

const normalizePhone = (phone) => {
  const value = normalizeOptionalText(phone);

  if (!value) {
    return undefined;
  }

  return value
    .replace(/\D/g, "")
    .slice(-10);
};

const getMapValue = (mapOrObject, key) => {
  if (!mapOrObject) {
    return undefined;
  }

  if (typeof mapOrObject.get === "function") {
    return mapOrObject.get(key);
  }

  if (typeof mapOrObject === "object") {
    return mapOrObject[key];
  }

  return undefined;
};

const validateTenantBusinessFields = ({
  email,
  phone,
  gstNo,
  panNo,
  pincode,
}) => {
  const normalizedEmail =
    normalizeOptionalText(email)?.toLowerCase();

  if (
    normalizedEmail &&
    !EMAIL_REGEX.test(normalizedEmail)
  ) {
    return {
      error: "Invalid business email",
    };
  }

  const normalizedPhone = normalizePhone(phone);

  if (
    normalizedPhone &&
    !PHONE_REGEX.test(normalizedPhone)
  ) {
    return {
      error: "Invalid phone number",
    };
  }

  const normalizedGst =
    normalizeOptionalText(gstNo)?.toUpperCase();

  if (
    normalizedGst &&
    !GST_REGEX.test(normalizedGst)
  ) {
    return {
      error: "Invalid GST number",
    };
  }

  const normalizedPan =
    normalizeOptionalText(panNo)?.toUpperCase();

  if (
    normalizedPan &&
    !PAN_REGEX.test(normalizedPan)
  ) {
    return {
      error: "Invalid PAN number",
    };
  }

  const normalizedPincode =
    normalizeOptionalText(pincode);

  if (
    normalizedPincode &&
    !PINCODE_REGEX.test(normalizedPincode)
  ) {
    return {
      error: "Invalid pincode",
    };
  }

  return {
    normalizedEmail,
    normalizedPhone,
    normalizedGst,
    normalizedPan,
    normalizedPincode,
  };
};

const validateTenantId = (tenantId) => {
  return mongoose.isValidObjectId(tenantId);
};

const validateUserId = (userId) => {
  return mongoose.isValidObjectId(userId);
};

const isTenantSubscriptionActive = (tenant) => {
  if (!tenant || tenant.isActive === false) {
    return false;
  }

  if (tenant.status !== "active") {
    return false;
  }

  if (
    tenant.subscriptionEnd &&
    new Date(tenant.subscriptionEnd) <=
      new Date()
  ) {
    return false;
  }

  return true;
};

const getTenantUserLimit = (tenant) => {
  const plan =
    SUBSCRIPTION_PLANS[
      tenant.subscriptionPlan
    ];

  const customLimit = getMapValue(
    tenant.limits,
    "users",
  );

  if (
    customLimit !== undefined &&
    customLimit !== null
  ) {
    return {
      limit: Number(customLimit),
      plan,
    };
  }

  return {
    limit: plan?.limits?.users,
    plan,
  };
};

const toPublicUser = (user) => ({
  _id: user._id,
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  designation: user.designation,
  notes: user.notes,
  platformRole: user.platformRole,
  tenantId: user.tenantId,
  clientCode: user.clientCode,
  isActive: user.isActive !== false,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const getTenants = async (req, res) => {
  try {
    const page = Math.max(
      parseInt(req.query.page, 10) || 1,
      1,
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit, 10) || 20,
        1,
      ),
      100,
    );

    const skip = (page - 1) * limit;

    const filter = {
      isActive: true,
    };

    if (req.query.status) {
      filter.status = String(
        req.query.status,
      )
        .trim()
        .toLowerCase();
    }

    if (req.query.search?.trim()) {
      const search = String(
        req.query.search,
      ).trim();

      filter.$or = [
        {
          businessName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          clientCode: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const [tenants, total] =
      await Promise.all([
        Tenant.find(filter)
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean(),

        Tenant.countDocuments(filter),
      ]);

    const tenantIds = tenants.map(
      (tenant) => tenant._id,
    );

    const userCounts = tenantIds.length
      ? await User.aggregate([
          {
            $match: {
              tenantId: {
                $in: tenantIds,
              },
              platformRole: "tenant",
              isActive: true,
            },
          },
          {
            $group: {
              _id: "$tenantId",
              count: {
                $sum: 1,
              },
            },
          },
        ])
      : [];

    const userCountMap = new Map(
      userCounts.map((item) => [
        String(item._id),
        item.count,
      ]),
    );

    const result = tenants.map((tenant) => ({
      ...tenant,
      userCount:
        userCountMap.get(
          String(tenant._id),
        ) || 0,
    }));

    return res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      tenants: result,
    });
  } catch (error) {
    console.error(
      "Get tenants error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tenants",
    });
  }
};

const getTenantById = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!validateTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenant id",
      });
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      isActive: true,
    }).lean();

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const userCount =
      await User.countDocuments({
        tenantId: tenant._id,
        platformRole: "tenant",
        isActive: true,
      });

    return res.json({
      success: true,
      tenant: {
        ...tenant,
        userCount,
      },
    });
  } catch (error) {
    console.error(
      "Get tenant error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tenant",
    });
  }
};

// const createTenant = async (req, res) => {
//   const session =
//     await mongoose.startSession();

//   try {
//     const {
//       businessName,
//       businessType,
//       email,
//       phone,
//       gstNo,
//       panNo,
//       address,
//       city,
//       state,
//       pincode,
//       subscriptionPlan,
//       subscriptionEnd,
//       adminName,
//       adminEmail,
//       adminPassword,
//     } = req.body;

//     if (
//       !businessName?.trim() ||
//       !adminName?.trim() ||
//       !adminEmail?.trim() ||
//       !adminPassword
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "businessName, adminName, adminEmail and adminPassword are required",
//       });
//     }

//     if (adminPassword.length < 6) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Admin password must be at least 6 characters",
//       });
//     }

//     const normalizedAdminEmail =
//       adminEmail.trim().toLowerCase();

//     if (
//       !EMAIL_REGEX.test(
//         normalizedAdminEmail,
//       )
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid admin email",
//       });
//     }

//     const businessValidation =
//       validateTenantBusinessFields({
//         email,
//         phone,
//         gstNo,
//         panNo,
//         pincode,
//       });

//     if (businessValidation.error) {
//       return res.status(400).json({
//         success: false,
//         message: businessValidation.error,
//       });
//     }

//     const planCode = String(
//       subscriptionPlan || "basic",
//     )
//       .trim()
//       .toLowerCase();

//     const selectedPlan =
//       SUBSCRIPTION_PLANS[planCode];

//     if (!selectedPlan) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid subscription plan",
//       });
//     }

//     const startDate = new Date();

//     const endDate = subscriptionEnd
//       ? new Date(
//           `${subscriptionEnd}T23:59:59.999`,
//         )
//       : new Date(
//           startDate.getTime() +
//             selectedPlan.durationDays *
//               24 *
//               60 *
//               60 *
//               1000,
//         );

//     if (
//       Number.isNaN(endDate.getTime()) ||
//       endDate <= startDate
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Subscription end date must be in the future",
//       });
//     }

//     const clientCode =
//       await getNextSequence(
//         "TRD",
//         "PLATFORM",
//       );

//     const hashedPassword =
//       await bcrypt.hash(
//         adminPassword,
//         12,
//       );

//     let createdTenant;
//     let createdAdmin;

//     await session.withTransaction(
//       async () => {
//         const tenantResult =
//           await Tenant.create(
//             [
//               {
//                 clientCode,
//                 businessName:
//                   businessName.trim(),
//                 businessType:
//                   businessType?.trim() ||
//                   "Trader",
//                 email:
//                   businessValidation.normalizedEmail,
//                 phone:
//                   businessValidation.normalizedPhone,
//                 gstNo:
//                   businessValidation.normalizedGst,
//                 panNo:
//                   businessValidation.normalizedPan,
//                 address:
//                   address?.trim() || undefined,
//                 city:
//                   city?.trim() || undefined,
//                 state:
//                   state?.trim() || undefined,
//                 pincode:
//                   businessValidation.normalizedPincode,
//                 subscriptionPlan: planCode,
//                 subscriptionStart: startDate,
//                 subscriptionEnd: endDate,
//                 features: [],
//                 status: "active",
//                 createdBy:
//                   req.user?.userId || null,
//               },
//             ],
//             {
//               session,
//             },
//           );

//         createdTenant = tenantResult[0];

//         const adminResult =
//           await User.create(
//             [
//               {
//                 name: adminName.trim(),
//                 email:
//                   normalizedAdminEmail,
//                 password: hashedPassword,
//                 platformRole: "tenant",
//                 role: "admin",
//                 tenantId:
//                   createdTenant._id,
//                 clientCode,
//                 permissions:
//                   getRolePermissions("admin"),
//                 isActive: true,
//               },
//             ],
//             {
//               session,
//             },
//           );

//         createdAdmin = adminResult[0];
//       },
//     );

//     return res.status(201).json({
//       success: true,
//       message:
//         "Trader created successfully",
//       tenant: createdTenant,
//       admin: toPublicUser(createdAdmin),
//     });
//   } catch (error) {
//     if (error.code === 11000) {
//       const duplicateField =
//         Object.keys(
//           error.keyPattern || {},
//         )[0];

//       const duplicateMessages = {
//         email: "Email already exists",
//         clientCode:
//           "Client code already exists",
//       };

//       return res.status(409).json({
//         success: false,
//         message:
//           duplicateMessages[
//             duplicateField
//           ] ||
//           "A duplicate record already exists",
//       });
//     }

//     console.error(
//       "Create tenant error:",
//       error,
//     );

//     return res.status(500).json({
//       success: false,
//       message: "Failed to create trader",
//     });
//   } finally {
//     await session.endSession();
//   }
// };

const createTenant = async (req, res) => {
  const session = await mongoose.startSession();

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
        message:
          "Admin password must be at least 6 characters",
      });
    }

    const normalizedAdminEmail =
      adminEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedAdminEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid admin email",
      });
    }

    const businessValidation =
      validateTenantBusinessFields({
        email,
        phone,
        gstNo,
        panNo,
        pincode,
      });

    if (businessValidation.error) {
      return res.status(400).json({
        success: false,
        message: businessValidation.error,
      });
    }

    const planCode = String(
      subscriptionPlan || "basic",
    )
      .trim()
      .toLowerCase();

    const selectedPlan =
      SUBSCRIPTION_PLANS[planCode];

    if (!selectedPlan) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan",
      });
    }

    const startDate = new Date();

    const endDate = subscriptionEnd
      ? new Date(
          `${subscriptionEnd}T23:59:59.999`,
        )
      : new Date(
          startDate.getTime() +
            selectedPlan.durationDays *
              24 *
              60 *
              60 *
              1000,
        );

    if (
      Number.isNaN(endDate.getTime()) ||
      endDate <= startDate
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Subscription end date must be in the future",
      });
    }

    const clientCode = await getNextSequence(
      "TRD",
      "PLATFORM",
    );

    const hashedPassword = await bcrypt.hash(
      adminPassword,
      12,
    );

    let createdTenant;
    let createdAdmin;

    await session.withTransaction(
      async () => {
        const tenantResult =
          await Tenant.create(
            [
              {
                clientCode,
                businessName:
                  businessName.trim(),
                businessType:
                  businessType?.trim() ||
                  "Trader",
                email:
                  businessValidation.normalizedEmail,
                phone:
                  businessValidation.normalizedPhone,
                gstNo:
                  businessValidation.normalizedGst,
                panNo:
                  businessValidation.normalizedPan,
                address:
                  address?.trim() || undefined,
                city:
                  city?.trim() || undefined,
                state:
                  state?.trim() || undefined,
                pincode:
                  businessValidation.normalizedPincode,
                subscriptionPlan: planCode,
                subscriptionStart: startDate,
                subscriptionEnd: endDate,
                features: [],
                status: "active",
                createdBy:
                  req.user?.userId || null,
              },
            ],
            {
              session,
            },
          );

        createdTenant = tenantResult[0];

        /*
          Seed the tenant's default Tally-style
          Chart of Accounts immediately.
        */
        await seedDefaultLedgerGroups({
          tenantId: createdTenant._id,
          userId: req.user?.userId || null,
          session,
        });

        /*
          Seed default system ledgers such as
          Cash, Sales, Purchase and GST ledgers.
        */
        await seedDefaultLedgers({
          tenantId: createdTenant._id,
          userId: req.user?.userId || null,
          session,
        });

        const adminResult =
          await User.create(
            [
              {
                name: adminName.trim(),
                email: normalizedAdminEmail,
                password: hashedPassword,
                platformRole: "tenant",
                role: "admin",
                tenantId: createdTenant._id,
                clientCode,
                permissions:
                  getRolePermissions("admin"),
                isActive: true,
              },
            ],
            {
              session,
            },
          );

        createdAdmin = adminResult[0];
      },
    );

    return res.status(201).json({
      success: true,
      message: "Trader created successfully",
      tenant: createdTenant,
      admin: toPublicUser(createdAdmin),
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateField = Object.keys(
        error.keyPattern || {},
      )[0];

      const duplicateMessages = {
        email: "Email already exists",
        clientCode:
          "Client code already exists",
      };

      return res.status(409).json({
        success: false,
        message:
          duplicateMessages[duplicateField] ||
          "A duplicate record already exists",
      });
    }

    console.error(
      "Create tenant error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to create trader",
    });
  } finally {
    await session.endSession();
  }
};
const updateTenant = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!validateTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenant id",
      });
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      isActive: true,
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }

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
    } = req.body;

    if (
      businessName !== undefined &&
      !String(businessName).trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Business name cannot be empty",
      });
    }

    const businessValidation =
      validateTenantBusinessFields({
        email,
        phone,
        gstNo,
        panNo,
        pincode,
      });

    if (businessValidation.error) {
      return res.status(400).json({
        success: false,
        message: businessValidation.error,
      });
    }

    if (businessName !== undefined) {
      tenant.businessName =
        String(businessName).trim();
    }

    if (businessType !== undefined) {
      tenant.businessType =
        String(businessType).trim() ||
        "Trader";
    }

    if (email !== undefined) {
      tenant.email =
        businessValidation.normalizedEmail ||
        undefined;
    }

    if (phone !== undefined) {
      tenant.phone =
        businessValidation.normalizedPhone ||
        undefined;
    }

    if (gstNo !== undefined) {
      tenant.gstNo =
        businessValidation.normalizedGst ||
        undefined;
    }

    if (panNo !== undefined) {
      tenant.panNo =
        businessValidation.normalizedPan ||
        undefined;
    }

    if (address !== undefined) {
      tenant.address =
        normalizeOptionalText(address);
    }

    if (city !== undefined) {
      tenant.city =
        normalizeOptionalText(city);
    }

    if (state !== undefined) {
      tenant.state =
        normalizeOptionalText(state);
    }

    if (pincode !== undefined) {
      tenant.pincode =
        businessValidation.normalizedPincode ||
        undefined;
    }

    await tenant.save();

    return res.json({
      success: true,
      message:
        "Company settings updated successfully",
      tenant,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Business email already exists",
      });
    }

    console.error(
      "Update tenant error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update company settings",
    });
  }
};

const getTenantUsers = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!validateTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenant id",
      });
    }

    const tenant = await Tenant.exists({
      _id: tenantId,
      isActive: true,
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }

    const users = await User.find({
      tenantId,
      platformRole: "tenant",
    })
      .select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires",
      )
      .sort({
        isActive: -1,
        name: 1,
      })
      .lean();

    return res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error(
      "Get tenant users error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
};

const createTenantUser = async (req, res) => {
  try {
    const { tenantId } = req.params;

    const {
      name,
      email,
      phone,
      password,
      role,
      designation,
      notes,
      permissions,
    } = req.body;

    if (!validateTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenant id",
      });
    }

    if (
      !name?.trim() ||
      !email?.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 6 characters",
      });
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    const normalizedPhone =
      normalizePhone(phone);

    const normalizedRole = String(
      role || "viewer",
    )
      .trim()
      .toLowerCase();

    if (
      !EMAIL_REGEX.test(normalizedEmail)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid email",
      });
    }

    if (
      normalizedPhone &&
      !PHONE_REGEX.test(normalizedPhone)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    if (
      !ALLOWED_ROLES.includes(
        normalizedRole,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    const tenant = await Tenant.findOne({
      _id: tenantId,
      isActive: true,
    });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found",
      });
    }

    if (!isTenantSubscriptionActive(tenant)) {
      return res.status(403).json({
        success: false,
        message:
          "Tenant subscription is not active",
      });
    }

    const activeUserCount =
      await User.countDocuments({
        tenantId: tenant._id,
        platformRole: "tenant",
        isActive: true,
      });

    const {
      limit: effectiveUserLimit,
      plan,
    } = getTenantUserLimit(tenant);

    if (
      Number.isFinite(effectiveUserLimit) &&
      activeUserCount >=
        effectiveUserLimit
    ) {
      return res.status(402).json({
        success: false,
        code: "USER_LIMIT_REACHED",
        message:
          "Your subscription user limit has been reached",
        limit: effectiveUserLimit,
        used: activeUserCount,
        includedUsers:
          plan?.includedUsers,
        extraUserPrice:
          plan?.extraUserPrice,
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: normalizedPhone || undefined,
      password: await bcrypt.hash(
        password,
        12,
      ),
      platformRole: "tenant",
      role: normalizedRole,
      designation:
        normalizeOptionalText(designation),
      notes: normalizeOptionalText(notes),
      tenantId: tenant._id,
      clientCode: tenant.clientCode,
      permissions: Array.isArray(
        permissions,
      )
        ? permissions
        : getRolePermissions(
            normalizedRole,
          ),
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message:
        "User created successfully",
      user: toPublicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    console.error(
      "Create tenant user error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to create user",
    });
  }
};

const updateTenantUser = async (req, res) => {
  try {
    const {
      tenantId,
      userId,
    } = req.params;

    const {
      name,
      email,
      phone,
      role,
      designation,
      notes,
      password,
      permissions,
    } = req.body;

    if (!validateTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenant id",
      });
    }

    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const user = await User.findOne({
      _id: userId,
      tenantId,
      platformRole: "tenant",
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (
      name !== undefined &&
      !String(name).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Name cannot be empty",
      });
    }

    if (email !== undefined) {
      const normalizedEmail = String(email)
        .trim()
        .toLowerCase();

      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email",
        });
      }

      user.email = normalizedEmail;
    }

    if (name !== undefined) {
      user.name = String(name).trim();
    }

    if (phone !== undefined) {
      const normalizedPhone =
        normalizePhone(phone);

      if (
        normalizedPhone &&
        !PHONE_REGEX.test(normalizedPhone)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number",
        });
      }

      user.phone =
        normalizedPhone || undefined;
    }

    if (role !== undefined) {
      const normalizedRole = String(role)
        .trim()
        .toLowerCase();

      if (
        !ALLOWED_ROLES.includes(
          normalizedRole,
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid role",
        });
      }

      user.role = normalizedRole;

      user.permissions =
        getRolePermissions(normalizedRole);
    }

    if (designation !== undefined) {
      user.designation =
        normalizeOptionalText(designation);
    }

    if (notes !== undefined) {
      user.notes =
        normalizeOptionalText(notes);
    }

    if (Array.isArray(permissions)) {
      user.permissions = permissions;
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 6 characters",
        });
      }

      user.password = await bcrypt.hash(
        password,
        12,
      );
    }

    await user.save();

    return res.json({
      success: true,
      message:
        "User updated successfully",
      user: toPublicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    console.error(
      "Update tenant user error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update user",
    });
  }
};

const updateTenantUserStatus = async (
  req,
  res,
) => {
  try {
    const {
      tenantId,
      userId,
    } = req.params;

    const { isActive } = req.body;

    if (!validateTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tenant id",
      });
    }

    if (!validateUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message:
          "isActive must be true or false",
      });
    }

    const user = await User.findOne({
      _id: userId,
      tenantId,
      platformRole: "tenant",
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (
      user.role === "admin" &&
      isActive === false
    ) {
      const otherActiveAdmins =
        await User.countDocuments({
          tenantId,
          platformRole: "tenant",
          role: "admin",
          isActive: true,
          _id: {
            $ne: user._id,
          },
        });

      if (otherActiveAdmins === 0) {
        return res.status(400).json({
          success: false,
          message:
            "At least one active admin is required",
        });
      }
    }

    user.isActive = isActive;

    await user.save();

    return res.json({
      success: true,
      message: isActive
        ? "User activated successfully"
        : "User deactivated successfully",
      user: toPublicUser(user),
    });
  } catch (error) {
    console.error(
      "Update tenant user status error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update user status",
    });
  }
};

module.exports = {
  getTenants,
  getTenantById,
  createTenant,
  updateTenant,
  getTenantUsers,
  createTenantUser,
  updateTenantUser,
  updateTenantUserStatus,
};