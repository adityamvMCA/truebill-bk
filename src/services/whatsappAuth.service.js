const bcrypt = require("bcrypt");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const WhatsAppSession = require("../models/WhatsAppSession");

const SESSION_DURATION_HOURS = 24;

/**
 * Normalizes phone numbers to digits only
 */
function cleanPhone(rawPhone) {
  if (!rawPhone) return "";
  let digits = String(rawPhone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = "91" + digits;
  return digits;
}

/**
 * Retrieves an active session for this phone number
 */
async function getSession(rawPhone) {
  const phone = cleanPhone(rawPhone);
  if (!phone) return null;

  const session = await WhatsAppSession.findOne({
    phone,
    expiresAt: { $gt: new Date() },
  }).lean();

  return session;
}

/**
 * Authenticates user credentials and creates a WhatsApp session
 */
async function authenticate(rawPhone, identifier, password) {
  const phone = cleanPhone(rawPhone);
  if (!phone) {
    return { success: false, message: "Phone number is required." };
  }

  const inputId = String(identifier || "").trim();
  const inputPass = String(password || "").trim();

  if (!inputId || !inputPass) {
    return {
      success: false,
      message: "Please provide both username/email and password.\nFormat: `login: <username> <password>`",
    };
  }

  const lower = inputId.toLowerCase();
  const queryConditions = [
    { email: lower },
    { username: lower },
    { clientCode: inputId.toUpperCase() },
  ];

  const digits = inputId.replace(/\D/g, "");
  if (digits.length >= 10) {
    queryConditions.push({ phone: digits.slice(-10) });
  }

  const user = await User.findOne({ $or: queryConditions }).select("+password");

  if (!user) {
    return {
      success: false,
      message: "❌ User not found with those details. Please check your username/email.",
    };
  }

  const isPasswordValid = await bcrypt.compare(inputPass, user.password);
  if (!isPasswordValid) {
    return {
      success: false,
      message: "❌ Incorrect password. Please try again.",
    };
  }

  // Determine tenant
  const tenantId = user.tenantId || user.primaryTenantId;
  if (!tenantId) {
    return {
      success: false,
      message: "❌ No business/tenant linked to this account.",
    };
  }

  const tenant = await Tenant.findById(tenantId).lean();
  const tenantName = tenant ? tenant.businessName : "Business";

  // Create or update session (valid for 24h)
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

  await WhatsAppSession.findOneAndUpdate(
    { phone },
    {
      phone,
      userId: user._id,
      userName: user.name || user.username || "User",
      tenantId: tenant._id,
      tenantName,
      expiresAt,
    },
    { upsert: true, new: true }
  );

  return {
    success: true,
    user: { name: user.name, tenantName },
    message: `✅ *Authentication Successful!*\n\nWelcome *${user.name}* (${tenantName}).\n\nYour session is active for 24 hours. You can now ask:\n• *"Today total cashflow"*\n• *"Today collections"*\n• Or any business question.`,
  };
}

/**
 * Removes session on logout
 */
async function logout(rawPhone) {
  const phone = cleanPhone(rawPhone);
  if (!phone) return;
  await WhatsAppSession.deleteOne({ phone });
  return "🔒 You have been logged out successfully.";
}

module.exports = {
  getSession,
  authenticate,
  logout,
  cleanPhone,
};
