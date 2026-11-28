const { calculateCashflow } = require("./aiCashflow.service");
const { identifyTenantByPhone, authenticate, logout } = require("./whatsappAuth.service");
const { callGraph, normalizePhone } = require("./whatsapp.service");

// LLM settings from environment or fallback to FreeLLMAPI
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://llm.trustiqtech.com/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "auto";

/**
 * Sends a WhatsApp text message directly via Meta Graph API
 */
async function sendWhatsAppDirect(recipientPhone, text) {
  if (!recipientPhone || !text) return;
  try {
    const to = normalizePhone(recipientPhone);
    const phoneId = process.env.PHONE_NUMBER_ID;
    if (!phoneId) {
      console.warn("sendWhatsAppDirect: No PHONE_NUMBER_ID configured in .env");
      return;
    }

    const res = await callGraph(`${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    console.log(`[WhatsApp Bot] Sent to ${to}:`, res?.messages?.[0]?.id || "ok");
    return res;
  } catch (err) {
    console.error(`[WhatsApp Bot] Send error to ${recipientPhone}:`, err.message, err.meta || "");
  }
}

/**
 * Main AI Message Handler
 * Automatically identifies tenant based on user's mobile number!
 */
async function handleIncomingWhatsAppMessage({ phone, message, tenantId: overrideTenantId }) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  let replyText = "";

  console.log(`[WhatsApp Bot] Processing message from ${phone}: "${text}"`);

  // 1. Check if user is submitting LOGIN credentials manually
  const loginPrefixMatch = text.match(/^login[:\s]+(.+)/i);
  if (loginPrefixMatch) {
    const credsPart = loginPrefixMatch[1].trim();
    const parts = credsPart.split(/[\s\n]+/);
    const identifier = parts[0];
    const password = parts.slice(1).join(" ");

    const authResult = await authenticate(phone, identifier, password);
    replyText = authResult.message;
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: authResult.success, reply: replyText };
  }

  // 2. Check if user wants to LOG OUT
  if (lower === "logout" || lower === "log out") {
    replyText = await logout(phone);
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText };
  }

  // 3. AUTO-IDENTIFY TENANT BASED ON USER MOBILE NUMBER!
  const identity = await identifyTenantByPhone(phone);

  let tenantId = overrideTenantId || identity?.tenantId;
  let tenantName = identity?.tenantName || "";
  let userName = identity?.userName || "";

  console.log(`[WhatsApp Bot] Tenant identification for ${phone}:`, {
    found: Boolean(identity),
    tenantName,
    userName,
    tenantId: tenantId ? String(tenantId) : null,
  });

  // 4. Check if the question is asking for business/financial data
  const isFinancialQuery =
    lower.includes("cashflow") ||
    lower.includes("cash flow") ||
    (lower.includes("cash") && lower.includes("today")) ||
    (lower.includes("collection") && lower.includes("today")) ||
    lower.includes("sales today") ||
    lower.includes("today sales") ||
    lower.includes("daily summary") ||
    lower.includes("balance");

  // If financial data requested but mobile number is not linked to any tenant:
  if (isFinancialQuery && !tenantId) {
    replyText = [
      `👋 Hello!`,
      ``,
      `Your WhatsApp mobile number (*+${phone}*) is not yet linked to any TrueBill business account.`,
      ``,
      `To connect your account, please send:`,
      `*login: <username/email> <password>*`,
      ``,
      `_Example:_`,
      `login: admin@trustiq.com myPassword123`,
      ``,
      `Once linked, you can ask for cashflow, sales, and accounts anytime directly!`,
    ].join("\n");

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: false, authenticated: false, reply: replyText };
  }

  // 5. Fetch live DB data if tenant is identified
  let liveContext = "";
  if (tenantId) {
    try {
      const liveData = await calculateCashflow({ tenantId });

      // Direct quick format for simple cashflow inquiries
      if (lower === "today total cashflow" || lower === "today cashflow" || lower === "cashflow") {
        replyText = `🏢 *${tenantName || "TrueBill"}*\n` + liveData.whatsappMessage;
        if (userName) replyText = `Hello *${userName}*,\n\n` + replyText;

        if (phone) await sendWhatsAppDirect(phone, replyText);
        return { success: true, reply: replyText, data: liveData };
      }

      liveContext = [
        `LIVE BUSINESS DATABASE DATA FOR TENANT "${tenantName || "TrueBill"}":`,
        `- Inflow today: Rs. ${liveData.inflow.total} (Cash: Rs. ${liveData.inflow.cash}, Bank/UPI: Rs. ${liveData.inflow.bank}, Receipts: ${liveData.inflow.receiptCount})`,
        `- Outflow today: Rs. ${liveData.outflow.total} (Supplier payments: Rs. ${liveData.outflow.supplierPayments}, Expenses: Rs. ${liveData.outflow.expenses})`,
        `- Net Cashflow today: Rs. ${liveData.netCashflow} (${liveData.status})`,
        `- Sales today: Rs. ${liveData.sales.total} (${liveData.sales.invoiceCount} invoices)`,
      ].join("\n");
    } catch (dbErr) {
      console.error("[WhatsApp Bot] DB query error:", dbErr.message);
    }
  }

  // 6. Use Self-Deployed LLM (FreeLLMAPI) to answer ANY question
  const systemPrompt = [
    `You are an intelligent AI business assistant for TrustIQ / TrueBill on WhatsApp.`,
    userName ? `The user communicating with you is "${userName}".` : "",
    tenantName ? `Their registered business/tenant name is "${tenantName}".` : "",
    liveContext ? `\nUse this real live database information to answer when relevant:\n${liveContext}` : "",
    `\nGuidelines:`,
    `- If the user asks about today's cashflow, collections, payments, or sales, answer using the exact figures from the database.`,
    `- If the user asks general accounting, tax, or business questions, answer clearly and helpfully.`,
    `- Keep responses concise, well-structured with emojis and bullet points suitable for WhatsApp.`,
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      // Fallback to direct cashflow text if LLM gateway has an issue
      if (isFinancialQuery && tenantId) {
        const liveData = await calculateCashflow({ tenantId });
        replyText = `🏢 *${tenantName || "TrueBill"}*\n` + liveData.whatsappMessage;
      } else {
        replyText = "I received your message, but the AI gateway is momentarily busy. Please try again.";
      }
    } else {
      const data = await response.json();
      replyText =
        data.choices?.[0]?.message?.content ||
        "Received your message, but no response was generated.";
    }

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText };
  } catch (err) {
    console.error("[WhatsApp Bot] LLM error:", err.message);
    replyText = "Sorry, I encountered an issue processing your request.";
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: false, error: err.message };
  }
}

module.exports = {
  handleIncomingWhatsAppMessage,
  sendWhatsAppDirect,
};
