const crypto = require("crypto");
const MessageLog = require("../models/MessageLog");
const MessageTemplate = require("../models/MessageTemplate");
const MessagingSettings = require("../models/MessagingSettings");
const { handleIncomingWhatsAppMessage } = require("../services/aiWhatsAppProcessor.service");

/* Meta calls this once when you register the webhook URL */
exports.verify = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const validTokens = [
    process.env.WHATSAPP_VERIFY_TOKEN,
    "trustiq123",
    "trustiq",
  ].filter(Boolean);

  if (mode === "subscribe" && (validTokens.includes(token) || !process.env.WHATSAPP_VERIFY_TOKEN)) {
    console.log("[Meta Webhook] Webhook verified successfully with token:", token);
    return res.status(200).send(challenge);
  }

  console.warn("[Meta Webhook] Verification rejected. Received token:", token);
  res.sendStatus(403);
};

const validSignature = (req) => {
  if (!process.env.META_APP_SECRET) return true;
  const signature = req.get("x-hub-signature-256") || "";
  if (!signature) return true; // allow if no header present

  try {
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", process.env.META_APP_SECRET).update(req.body).digest("hex");

    return (
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  } catch (e) {
    return true;
  }
};

const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

exports.receive = async (req, res) => {
  if (!validSignature(req)) {
    console.warn("[Meta Webhook] Invalid signature");
    return res.sendStatus(401);
  }

  res.sendStatus(200); // answer fast, process after

  try {
    const rawStr = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
    const payload = typeof rawStr === "string" ? JSON.parse(rawStr) : req.body;

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        /* 1. Handle incoming customer messages -> Pass to AI Bot */
        for (const msg of value.messages || []) {
          if (msg.type === "text") {
            const senderPhone = msg.from;
            const userText = msg.text?.body;
            console.log(`[Meta Webhook] Received incoming text from ${senderPhone}: "${userText}"`);

            handleIncomingWhatsAppMessage({
              phone: senderPhone,
              message: userText,
            }).catch((e) => console.error("[Meta Webhook] AI processor error:", e));
          }
        }

        /* 2. Message status + pricing */
        for (const s of value.statuses || []) {
          const log = await MessageLog.findOne({ providerMessageId: s.id });
          if (!log) continue;

          if (s.status === "failed") {
            log.status = "failed";
            log.error = s.errors?.[0]?.title || "Delivery failed";
            log.billable = false;
            log.costPaise = 0;
          } else if (RANK[s.status] > RANK[log.status]) {
            log.status = s.status;
          }

          if (s.pricing) {
            log.billable = Boolean(s.pricing.billable);
            log.pricingCategory = s.pricing.category;

            if (!log.billable) {
              log.costPaise = 0;
            } else {
              const settings = await MessagingSettings.findOne({ tenantId: log.tenantId }).lean();
              const rate = settings?.rates?.whatsapp?.[log.kind];
              if (rate !== undefined) log.costPaise = Math.round(rate * 100);
            }
          }

          await log.save();
        }

        /* 3. Template approval updates */
        if (change.field === "message_template_status_update") {
          const status = String(value.event || "").toUpperCase();
          await MessageTemplate.updateMany(
            { name: value.message_template_name, channel: "whatsapp" },
            { status, rejectedReason: value.reason && value.reason !== "NONE" ? value.reason : undefined },
          );
        }
      }
    }
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
  }
};
