const express = require("express");
const router = express.Router();
const { calculateCashflow } = require("../services/aiCashflow.service");
const { getSession, authenticate, logout } = require("../services/whatsappAuth.service");

// LLM settings from environment or fallback to FreeLLMAPI
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://llm.trustiqtech.com/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "auto";

/**
 * Extracts phone and message from various possible WACRM webhook payloads
 */
function extractPayload(req) {
  const b = req.body || {};
  const q = req.query || {};

  const phone =
    b.phone ||
    b.contact?.phone ||
    b.from ||
    b.sender ||
    b.phone_number ||
    q.phone ||
    q.from ||
    "";

  const message =
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
 * Authenticates user, checks tenant session, and responds based on query.
 */
async function processWhatsAppQuery(req, res) {
  try {
    const { phone, message } = extractPayload(req);

    // If no message text was passed, treat as a direct cashflow request
    if (!message) {
      return getCashflowHandler(req, res);
    }

    const text = message.trim();
    const lower = text.toLowerCase();

    // 1. Check if user is trying to LOG OUT
    if (lower === "logout" || lower === "log out") {
      const msg = await logout(phone);
      return res.json({ success: true, reply: msg, message: msg, text: msg });
    }

    // 2. Check if user is submitting LOGIN credentials
    // Format: "login: user password", "login user password"
    const loginPrefixMatch = text.match(/^login[:\s]+(.+)/i);
    if (loginPrefixMatch) {
      const credsPart = loginPrefixMatch[1].trim();
      const parts = credsPart.split(/[\s\n]+/);
      const identifier = parts[0];
      const password = parts.slice(1).join(" ");

      const authResult = await authenticate(phone, identifier, password);
      return res.json({
        success: authResult.success,
        reply: authResult.message,
        message: authResult.message,
        text: authResult.message,
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
          const authPrompt = [
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

          return res.json({
            success: false,
            authenticated: false,
            reply: authPrompt,
            message: authPrompt,
            text: authPrompt,
          });
        }

        tenantId = session.tenantId;
        tenantName = session.tenantName;
      }
    }

    // 5. If it's a cashflow query and authenticated:
    if (isFinancialQuery) {
      const cashflowResult = await calculateCashflow({ tenantId });
      let replyText = cashflowResult.whatsappMessage;
      if (tenantName) {
        replyText = `🏢 *${tenantName}*\n` + replyText;
      }

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
      return res.json({
        success: true,
        reply: "I received your message, but the AI gateway is temporarily unavailable. Please try again.",
      });
    }

    const data = await response.json();
    const aiReply =
      data.choices?.[0]?.message?.content ||
      "Received your message, but no response was generated.";

    return res.json({
      success: true,
      reply: aiReply,
      message: aiReply,
      text: aiReply,
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
