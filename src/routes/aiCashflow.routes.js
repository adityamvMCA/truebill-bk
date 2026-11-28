const express = require("express");
const router = express.Router();
const { calculateCashflow } = require("../services/aiCashflow.service");
const { getSession, authenticate, logout } = require("../services/whatsappAuth.service");
const { callGraph, normalizePhone } = require("../services/whatsapp.service");

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
    console.log(`WhatsApp message sent to ${to}:`, res?.messages?.[0]?.id || "ok");
    return res;
  } catch (err) {
    console.error(`WhatsApp send error to ${recipientPhone}:`, err.message, err.meta || "");
  }
}

/**
 * Extracts phone and message from various possible webhook formats
 */
function extractPayload(req) {
  const b = req.body || {};
  const q = req.query || {};

  // Check if standard Meta webhook payload
  const metaMsg = b.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const metaPhone = metaMsg?.from;
  const metaText = metaMsg?.text?.body;

  const phone =
    metaPhone ||
    b.phone ||
    b.contact?.phone ||
    b.from ||
    b.sender ||
    b.phone_number ||
    q.phone ||
    q.from ||
    "";

  const message =
    metaText ||
    b.message ||
    b.text ||
    b.body ||
    b.message_text ||
    b.msg ||
    q.message ||
    q.text ||
    "";

  return {
    phone: String(phone).trim(),
    message: String(message).trim(),
  };
}

/**
 * Direct cashflow handler
 */
async function getCashflowHandler(req, res) {
  try {
    const tenantId = req.query.tenantId || req.body?.tenantId;
    const date = req.query.date || req.body?.date;
    const format = req.query.format || req.body?.format;

    const result = await calculateCashflow({ tenantId, date });

    if (format === "text") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(result.whatsappMessage);
    }

    return res.json({
      success: true,
      reply: result.whatsappMessage,
      message: result.whatsappMessage,
      text: result.whatsappMessage,
      data: result,
    });
  } catch (error) {
    console.error("Cashflow handler error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Main Webhook Handler:
 * Authenticates user, checks tenant session, processes query, and
 * directly sends the WhatsApp response back to the customer's mobile!
 */
async function processWhatsAppQuery(req, res) {
  try {
    const { phone, message } = extractPayload(req);
    console.log(`[AI WhatsApp] Incoming request from ${phone || "unknown"}: "${message}"`);

    // If no message text was passed, treat as a direct cashflow request
    if (!message) {
      return getCashflowHandler(req, res);
    }

    const text = message.trim();
    const lower = text.toLowerCase();
    let replyText = "";

    // 1. Check if user is trying to LOG OUT
    if (lower === "logout" || lower === "log out") {
      replyText = await logout(phone);
      if (phone) await sendWhatsAppDirect(phone, replyText);
      return res.json({ success: true, reply: replyText, message: replyText, text: replyText });
    }

    // 2. Check if user is submitting LOGIN credentials
    // Formats: "login: user pass", "login user pass"
    const loginPrefixMatch = text.match(/^login[:\s]+(.+)/i);
    if (loginPrefixMatch) {
      const credsPart = loginPrefixMatch[1].trim();
      const parts = credsPart.split(/[\s\n]+/);
      const identifier = parts[0];
      const password = parts.slice(1).join(" ");

      const authResult = await authenticate(phone, identifier, password);
      replyText = authResult.message;
      if (phone) await sendWhatsAppDirect(phone, replyText);
      return res.json({
        success: authResult.success,
        reply: replyText,
        message: replyText,
        text: replyText,
      });
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

    let tenantId = req.query.tenantId || req.body?.tenantId;
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
          return res.json({
            success: false,
            authenticated: false,
            reply: replyText,
            message: replyText,
            text: replyText,
          });
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
      return res.json({
        success: true,
        reply: replyText,
        message: replyText,
        text: replyText,
        data: cashflowResult,
      });
    }

    // 6. For all other general questions, ask self-deployed LLM
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
      return res.json({ success: true, reply: replyText });
    }

    const data = await response.json();
    replyText =
      data.choices?.[0]?.message?.content ||
      "Received your message, but no response was generated.";

    if (phone) await sendWhatsAppDirect(phone, replyText);
    return res.json({
      success: true,
      reply: replyText,
      message: replyText,
      text: replyText,
    });
  } catch (error) {
    console.error("AI WhatsApp processor error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process message",
    });
  }
}

// Routes
router.get("/cashflow/today", getCashflowHandler);
router.post("/cashflow/today", processWhatsAppQuery);
router.post("/process-message", processWhatsAppQuery);
router.post("/chat", processWhatsAppQuery);

module.exports = router;
