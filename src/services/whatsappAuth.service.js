const bcrypt = require("bcrypt");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const WhatsAppSession = require("../models/WhatsAppSession");

const SESSION_DURATION_HOURS = 24 * 30; // 30 days for mobile-identified users

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
 * Automatically identifies a Tenant and User directly from their mobile number!
 */
async function identifyTenantByPhone(rawPhone) {
  const digits = cleanPhone(rawPhone);
  if (!digits) return null;

  const last10 = digits.slice(-10);
  const possiblePhoneFormats = [
    digits,
    last10,
    `+91${last10}`,
    `91${last10}`,
    `+91 ${last10}`,
    `0${last10}`,
  ];

  // 1. Search in User collection
  let user = await User.findOne({
    phone: { $in: possiblePhoneFormats },
  }).lean();

  if (!user && last10.length === 10) {
    user = await User.findOne({
      phone: new RegExp(`${last10}$`),
    }).lean();
  }

  if (user) {
    const tenantId = user.tenantId || user.primaryTenantId;
    let tenantName = "Business";
    if (tenantId) {
      const tenant = await Tenant.findById(tenantId).lean();
      if (tenant) tenantName = tenant.businessName;
    }

    return {
      authenticated: true,
      byPhone: true,
      userId: user._id,
      userName: user.name || user.username || "User",
      tenantId,
      tenantName,
      phone: digits,
    };
  }

  // 2. Search in Tenant collection directly (if business owner phone is in Tenant)
  const tenant = await Tenant.findOne({
    $or: [
      { phone: { $in: possiblePhoneFormats } },
      { contactPhone: { $in: possiblePhoneFormats } },
    ],
    isActive: true,
  }).lean();

  if (tenant) {
    return {
      authenticated: true,
      byPhone: true,
      userId: null,
      userName: tenant.contactPerson || tenant.businessName,
      tenantId: tenant._id,
      tenantName: tenant.businessName,
      phone: digits,
    };
  }

  // 3. Fallback: Check if there's an active session previously created via password
  const session = await WhatsAppSession.findOne({
    phone: digits,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (session) {
    return {
      authenticated: true,
      byPhone: false,
      userId: session.userId,
      userName: session.userName,
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      phone: digits,
    };
  }

  return null;
}

/**
 * Manual login fallback if phone number is not yet in the DB
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

  const tenantId = user.tenantId || user.primaryTenantId;
  if (!tenantId) {
    return {
      success: false,
      message: "❌ No business/tenant linked to this account.",
    };
  }

  const tenant = await Tenant.findById(tenantId).lean();
  const tenantName = tenant ? tenant.businessName : "Business";

  // Auto-save this phone to the user so future messages don't need login!
  if (!user.phone && phone.length >= 10) {
    await User.findByIdAndUpdate(user._id, { phone: phone.slice(-10) });
  }

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
    message: `✅ *Authentication Successful!*\n\nWelcome *${user.name}* (*${tenantName}*).\n\nYour mobile number is now connected. You can ask:\n• *"Today total cashflow"*\n• *"Today sales"*\n• Or any question directly!`,
  };
}

async function logout(rawPhone) {
  const phone = cleanPhone(rawPhone);
  if (!phone) return;
  await WhatsAppSession.deleteOne({ phone });
  return "🔒 You have been logged out.";
}

module.exports = {
  identifyTenantByPhone,
  authenticate,
  logout,
  cleanPhone,
};
