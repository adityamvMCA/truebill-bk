const express = require("express");
const router = express.Router();
const { calculateCashflow } = require("../services/aiCashflow.service");
const { handleIncomingWhatsAppMessage } = require("../services/aiWhatsAppProcessor.service");

/**
 * Extracts phone and message from various possible webhook formats
 */
function extractPayload(req) {
  const b = req.body || {};
  const q = req.query || {};

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
 * Process WhatsApp query via HTTP
 */
async function processWhatsAppRoute(req, res) {
  try {
    const { phone, message } = extractPayload(req);
    const tenantId = req.query.tenantId || req.body?.tenantId;

    if (!message) {
      return getCashflowHandler(req, res);
    }

    const result = await handleIncomingWhatsAppMessage({
      phone,
      message,
      tenantId,
    });

    return res.json({
      success: result.success,
      reply: result.reply,
      message: result.reply,
      text: result.reply,
      data: result.data || null,
    });
  } catch (error) {
    console.error("AI WhatsApp route error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process message",
    });
  }
}

// Routes
router.get("/cashflow/today", getCashflowHandler);
router.post("/cashflow/today", processWhatsAppRoute);
router.post("/process-message", processWhatsAppRoute);
router.post("/chat", processWhatsAppRoute);

module.exports = router;
