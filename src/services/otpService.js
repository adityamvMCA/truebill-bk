const crypto = require("crypto");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const LoginOtp = require("../models/LoginOtp");
const { sendText } = require("./whatsapp");

const OTP_EXPIRY_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Normalizes phone numbers:
 * - Returns clean 10-digit number for DB queries (e.g. "7204105844")
 * - Returns international recipient for WhatsApp Cloud API (e.g. "917204105844")
 */
const normalizePhone = (input) => {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }
  let local10 = digits;
  let international = digits;

  if (digits.length === 10) {
    local10 = digits;
    international = `91${digits}`;
  } else if (digits.length === 12 && digits.startsWith("91")) {
    local10 = digits.slice(2);
    international = digits;
  } else if (digits.length > 10) {
    local10 = digits.slice(-10);
    international = digits;
  }

  return { local10, international };
};

/**
 * Finds active users matching the phone number.
 * Searches User.phone as well as Tenant.phone (for tenant admin/users).
 */
const findUsersByPhone = async (rawPhone) => {
  const { local10 } = normalizePhone(rawPhone);
  if (!local10 || local10.length < 10) {
    return [];
  }

  const phoneRegex = new RegExp(`${local10}$`);

  // 1. Direct User match
  let users = await User.find({
    phone: { $regex: phoneRegex },
    isActive: true,
  })
    .populate("tenantId", "businessName clientCode status isActive subscriptionPlan subscriptionEnd")
    .lean();

  // 2. If no direct match on User.phone, search Tenant.phone
  if (!users || users.length === 0) {
    const matchingTenants = await Tenant.find({
      phone: { $regex: phoneRegex },
      isActive: true,
    })
      .select("businessName clientCode status isActive subscriptionPlan subscriptionEnd")
      .lean();

    if (matchingTenants.length > 0) {
      const tenantIds = matchingTenants.map((t) => t._id);
      const tenantUsers = await User.find({
        tenantId: { $in: tenantIds },
        isActive: true,
      })
        .populate("tenantId", "businessName clientCode status isActive subscriptionPlan subscriptionEnd")
        .lean();

      // If tenant users found, prefer admin users or all active users
      if (tenantUsers.length > 0) {
        users = tenantUsers;

        // Auto-sync User.phone in background for faster subsequent lookups
        const userIdsToUpdate = tenantUsers.filter((u) => !u.phone).map((u) => u._id);
        if (userIdsToUpdate.length > 0) {
          User.updateMany({ _id: { $in: userIdsToUpdate } }, { $set: { phone: local10 } }).catch(
            (err) => console.error("Error auto-syncing User.phone:", err),
          );
        }
      }
    }
  }

  return users;
};

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
const generateOtp = () => crypto.randomInt(100000, 999999).toString();

/**
 * Dispatches WhatsApp OTP message.
 * Supports templates with:
 * - 2 variables: {{1}} = User Name, {{2}} = OTP Code (e.g. "Hi {{1}}, {{2}} is your login verification code for TrueBill...")
 * - 1 variable: {{1}} = OTP Code
 * Automatically falls back to direct WhatsApp delivery if template is not yet approved in Meta.
 */
const sendWhatsAppOtp = async ({ to, otpCode, userName = "User" }) => {
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE || "school_notice_common";
  const { international } = normalizePhone(to);
  const cleanName = String(userName || "User").trim();

  let templateSent = false;
  let lastError = null;

  // Attempt 1: Meta WhatsApp Template
  try {
    const base = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v21.0"}`;
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;

    if (token && phoneId) {
      // 1A. Try approved single-variable template (e.g. school_notice_common)
      const otpMessageText = `Hi *${cleanName}*, *${otpCode}* is your login verification code for TrueBill. Valid for ${OTP_EXPIRY_MINUTES} minutes. Please do not share this code with anyone.`;
      
      let res = await fetch(`${base}/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: international,
          type: "template",
          template: {
            name: templateName,
            language: { code: process.env.WHATSAPP_OTP_LANG || "en" },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: otpMessageText }],
              },
            ],
          },
        }),
      });

      let data = await res.json().catch(() => ({}));

      // 1B. If custom template with 2 variables [userName, otpCode] is configured
      if (!res.ok) {
        res = await fetch(`${base}/${phoneId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: international,
            type: "template",
            template: {
              name: templateName,
              language: { code: process.env.WHATSAPP_OTP_LANG || "en" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: cleanName },
                    { type: "text", text: String(otpCode) },
                  ],
                },
              ],
            },
          }),
        });
        data = await res.json().catch(() => ({}));
      }

      if (res.ok && data?.messages?.[0]?.id) {
        templateSent = true;
        return {
          success: true,
          method: "template",
          templateName,
          messageId: data.messages[0].id,
        };
      } else {
        lastError = data?.error?.message || "Template send returned error";
      }
    }
  } catch (err) {
    lastError = err.message;
  }

  // Attempt 2: Fallback to direct WhatsApp text message with user name and TrueBill branding
  try {
    const textMessage = `Hi *${cleanName}*,\n\n*${otpCode}* is your login verification code for TrueBill. Valid for ${OTP_EXPIRY_MINUTES} minutes. Please do not share this code with anyone.`;

    const messageId = await sendText({
      to: international,
      text: textMessage,
    });

    return {
      success: true,
      method: "text",
      messageId,
      notice: lastError ? `Template failed (${lastError}), delivered via WhatsApp direct text.` : undefined,
    };
  } catch (textErr) {
    console.error("Failed to send WhatsApp OTP:", textErr);
    throw new Error(
      textErr.message || "Failed to deliver OTP to WhatsApp. Please check your number.",
    );
  }
};

/**
 * Creates and dispatches OTP for a given mobile number.
 * Automatically identifies the user without asking the user to select.
 */
const requestOtp = async ({ phone, userId = null }) => {
  const { local10, international } = normalizePhone(phone);
  if (!local10 || local10.length < 10) {
    throw new Error("Please enter a valid 10-digit mobile number");
  }

  const matchingUsers = await findUsersByPhone(local10);
  if (!matchingUsers || matchingUsers.length === 0) {
    throw new Error(
      `No registered account found with mobile number +91 ${local10}. Please check the number or sign in with your email and password.`,
    );
  }

  // Automatically identify the user without prompting to select
  let selectedUser = null;
  if (userId) {
    selectedUser = matchingUsers.find((u) => String(u._id) === String(userId));
  }
  if (!selectedUser) {
    selectedUser =
      matchingUsers.find((u) => u.phone === local10) ||
      matchingUsers.find((u) => u.role === "admin") ||
      matchingUsers[0];
  }

  // Check cooldown to prevent rapid spamming (allow 1 request per 30s)
  const existingOtp = await LoginOtp.findOne({
    phone: local10,
    userId: selectedUser._id,
  }).sort({ createdAt: -1 });

  if (existingOtp) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(existingOtp.createdAt).getTime()) / 1000);
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      const waitRemaining = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      throw new Error(`Please wait ${waitRemaining}s before requesting a new OTP.`);
    }
  }

  const otpCode = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  console.log(`\n======================================================`);
  console.log(`🔐 [TrueBill WhatsApp OTP] Identified User: ${selectedUser.name} (${selectedUser.email})`);
  console.log(`📱 Mobile Number: +91 ${local10}`);
  console.log(`👉 OTP CODE: ${otpCode} (Valid for ${OTP_EXPIRY_MINUTES} mins)`);
  console.log(`======================================================\n`);

  // Send on WhatsApp
  const dispatchResult = await sendWhatsAppOtp({
    to: international,
    otpCode,
    userName: selectedUser.name || "User",
  });

  // Remove existing pending OTPs for this user
  await LoginOtp.deleteMany({ userId: selectedUser._id });

  // Store new OTP
  await LoginOtp.create({
    phone: local10,
    otp: otpCode,
    userId: selectedUser._id,
    tenantId: selectedUser.tenantId?._id || selectedUser.tenantId || null,
    attempts: 0,
    expiresAt,
  });

  return {
    success: true,
    phone: local10,
    maskedPhone: `+91 ${local10.slice(0, 2)}******${local10.slice(-2)}`,
    userId: selectedUser._id,
    accountName: selectedUser.name,
    businessName: selectedUser.tenantId?.businessName || null,
    cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    method: dispatchResult.method,
  };
};

/**
 * Validates the entered OTP code.
 */
const verifyOtp = async ({ phone, otp, userId }) => {
  const { local10 } = normalizePhone(phone);
  const cleanOtp = String(otp || "").trim();

  if (!cleanOtp || cleanOtp.length < 4) {
    throw new Error("Please enter a valid OTP code");
  }

  const query = {
    otp: cleanOtp,
    expiresAt: { $gt: new Date() },
  };

  if (userId) {
    query.userId = userId;
  } else if (local10) {
    query.phone = local10;
  } else {
    throw new Error("Phone number or account ID is required");
  }

  const otpRecord = await LoginOtp.findOne(query);

  if (!otpRecord) {
    // Check if OTP was wrong or expired
    const attemptQuery = userId ? { userId } : { phone: local10 };
    const pendingRecord = await LoginOtp.findOne(attemptQuery).sort({ createdAt: -1 });

    if (pendingRecord) {
      if (new Date() > pendingRecord.expiresAt) {
        await LoginOtp.deleteOne({ _id: pendingRecord._id });
        throw new Error("The OTP has expired. Please request a new code.");
      }

      pendingRecord.attempts = (pendingRecord.attempts || 0) + 1;
      if (pendingRecord.attempts >= 5) {
        await LoginOtp.deleteOne({ _id: pendingRecord._id });
        throw new Error("Too many incorrect attempts. Please request a new OTP.");
      }
      await pendingRecord.save();
      throw new Error(`Invalid OTP. You have ${5 - pendingRecord.attempts} attempt(s) remaining.`);
    }

    throw new Error("Invalid or expired OTP. Please request a new code.");
  }

  // Find user
  const user = await User.findById(otpRecord.userId);
  if (!user || !user.isActive) {
    throw new Error("User account is inactive or not found");
  }

  // Delete used OTP
  await LoginOtp.deleteMany({ userId: user._id });

  return { valid: true, user };
};

module.exports = {
  normalizePhone,
  findUsersByPhone,
  generateOtp,
  sendWhatsAppOtp,
  requestOtp,
  verifyOtp,
  RESEND_COOLDOWN_SECONDS,
  OTP_EXPIRY_MINUTES,
};
