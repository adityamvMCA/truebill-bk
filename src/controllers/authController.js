// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");
// const User = require("../models/User");
// const Tenant = require("../models/Tenant");
// const { getRolePermissions } = require("../utils/permissions");
// const login = async (req, res) => {
//   const { email, username, password } = req.body;
//   if (!password || (!email && !username))
//     return res
//       .status(400)
//       .json({
//         success: false,
//         message: "Email/Username and password are required",
//       });
//   const q = [];
//   if (email) q.push({ email: String(email).toLowerCase().trim() });
//   if (username) q.push({ username: String(username).toLowerCase().trim() });
//   const user = await User.findOne({ $or: q }).select("+password");
//   if (!user)
//     return res
//       .status(401)
//       .json({ success: false, message: "Invalid credentials" });
//   if (!user.isActive)
//     return res
//       .status(403)
//       .json({ success: false, message: "User account is inactive" });
//   if (!(await bcrypt.compare(password, user.password)))
//     return res
//       .status(401)
//       .json({ success: false, message: "Invalid credentials" });
//   let tenant = null;
//   if (user.tenantId) {
//     tenant = await Tenant.findById(user.tenantId).lean();
//     if (!tenant || !tenant.isActive)
//       return res
//         .status(403)
//         .json({ success: false, message: "Tenant is inactive or unavailable" });
//   }
//   const token = jwt.sign(
//     {
//       userId: user._id,
//       platformRole: user.platformRole,
//       role: user.role,
//       tenantId: user.tenantId,
//       clientCode: user.clientCode,
//       developerCode: user.developerCode,
//     },
//     process.env.JWT_SECRET,
//     { expiresIn: process.env.JWT_EXPIRES_IN || "24h" },
//   );
//   user.lastLoginAt = new Date();
//   await user.save();
//   res.json({
//     success: true,
//     message: "Login successful",
//     token,
//     user: {
//       id: user._id,
//       name: user.name,
//       email: user.email,
//       username: user.username,
//       platformRole: user.platformRole,
//       role: user.role,
//       tenantId: user.tenantId,
//       clientCode: user.clientCode,
//       developerCode: user.developerCode,
//       permissions: user.permissions?.length
//         ? user.permissions
//         : getRolePermissions(user.role),
//       tenant,
//     },
//   });
// };
// const me = async (req, res) => res.json({ success: true, user: req.user });
// module.exports = { login, me };


const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const { getRolePermissions } = require("../utils/permissions");
const {
  getEntitlements,
  serializeEntitlements,
} = require("../services/entitlements");

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

const DUMMY_HASH =
  "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.Qe6Zc5Yw2cH3vC0v1o9m0o8m5q8a";

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
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

const login = async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!password || (!email && !username))
      return fail(res, 400, "Email/Username and password are required");

    const q = [];
    if (email) q.push({ email: String(email).toLowerCase().trim() });
    if (username) q.push({ username: String(username).toLowerCase().trim() });

    const user = await User.findOne({ $or: q }).select("+password");

    const hash = user?.password || DUMMY_HASH;
    const passwordOk = await bcrypt.compare(String(password), hash);

    if (!user || !passwordOk) return fail(res, 401, "Invalid credentials");
    if (!user.isActive) return fail(res, 403, "User account is inactive");

    let tenant = null;
    let subscription = null;

    if (user.tenantId) {
      tenant = await Tenant.findById(user.tenantId)
        .select("name code status isActive subscriptionPlan subscriptionEnd")
        .lean();

      if (!tenant || !tenant.isActive)
        return fail(res, 403, "Tenant is inactive or unavailable");

      subscription = serializeEntitlements(await getEntitlements(user.tenantId));
    }

    const token = jwt.sign(
      {
        userId: user._id,
        platformRole: user.platformRole,
        role: user.role,
        tenantId: user.tenantId,
        clientCode: user.clientCode,
        developerCode: user.developerCode,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
    );

    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: { ...publicUser(user), tenant },
      subscription,
    });
  } catch (error) {
    console.error("Login error:", error);
    return fail(res, 500, "Login failed");
  }
};

const me = async (req, res) => {
  try {
    let subscription = null;
    let tenant = null;

    if (req.user.tenantId) {
      tenant = await Tenant.findById(req.user.tenantId)
        .select("name code status isActive subscriptionPlan subscriptionEnd")
        .lean();
      subscription = serializeEntitlements(
        await getEntitlements(req.user.tenantId)
      );
    }

    return res.json({
      success: true,
      user: { ...req.user, tenant },
      subscription,
    });
  } catch (error) {
    console.error("Me error:", error);
    return fail(res, 500, "Failed to load profile");
  }
};

module.exports = { login, me };