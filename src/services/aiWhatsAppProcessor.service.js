const { calculateCashflow } = require("./aiCashflow.service");
const { getSession, authenticate, logout } = require("./whatsappAuth.service");
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
 * Used by both whatsappWebhook.controller.js and aiCashflow.routes.js
 */
async function handleIncomingWhatsAppMessage({ phone, message, tenantId: overrideTenantId }) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  let replyText = "";

  console.log(`[WhatsApp Bot] Processing message from ${phone}: "${text}"`);

  // 1. Check if user is trying to LOG OUT
  if (lower === "logout" || lower === "log out") {
    replyText = await logout(phone);
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText };
  }

  // 2. Check if user is submitting LOGIN credentials
  // Formats supported: "login: user pass", "login user pass"
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

  // 3. Check if query is requesting business/tenant-specific financial data
  const isFinancialQuery =
    lower.includes("cashflow") ||
    lower.includes("cash flow") ||
    (lower.includes("cash") && lower.includes("today")) ||
    (lower.includes("collection") && lower.includes("today")) ||
    lower.includes("sales today") ||
    lower.includes("today sales") ||
    lower.includes("daily summary") ||
    lower.includes("balance");

  let tenantId = overrideTenantId;
  let tenantName = "";

  // 4. If financial query, verify session authentication
  if (isFinancialQuery) {
    if (phone) {
      const session = await getSession(phone);
      if (!session) {
        replyText = [
          `🔒 *Authentication Required*`,
          ``,
          `To view live financial and cashflow data for your business, please login first.`,
          ``,
          `Reply with:`,
          `*login: <username/email> <password>*`,
          ``,
          `_Example:_`,
          `login: admin@trustiq.com myPassword123`,
        ].join("\n");

        if (phone) await sendWhatsAppDirect(phone, replyText);
        return { success: false, authenticated: false, reply: replyText };
      }

      tenantId = session.tenantId;
      tenantName = session.tenantName;
    }
  }

  // 5. If it's a cashflow query and authenticated:
  if (isFinancialQuery) {
    const cashflowResult = await calculateCashflow({ tenantId });
    replyText = cashflowResult.whatsappMessage;
    if (tenantName) {
      replyText = `🏢 *${tenantName}*\n` + replyText;
    }

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText, data: cashflowResult };
  }

  // 6. For all other general questions, ask self-deployed LLM
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
          {
            role: "system",
            content:
              "You are an intelligent business AI assistant for TrustIQ / TrueBill on WhatsApp. " +
              "Answer questions clearly and concisely. Format responses with emojis and bullet points for WhatsApp.",
          },
          { role: "user", content: text },
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      replyText = "I received your message, but the AI gateway is temporarily unavailable. Please try again.";
      if (phone) await sendWhatsAppDirect(phone, replyText);
      return { success: true, reply: replyText };
    }

    const data = await response.json();
    replyText =
      data.choices?.[0]?.message?.content ||
      "Received your message, but no response was generated.";

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: true, reply: replyText };
  } catch (err) {
    console.error("[WhatsApp Bot] LLM error:", err.message);
    replyText = "Sorry, I encountered an issue processing your question.";
    if (phone) await sendWhatsAppDirect(phone, replyText);
    return { success: false, error: err.message };
  }
}

module.exports = {
  handleIncomingWhatsAppMessage,
  sendWhatsAppDirect,
};
