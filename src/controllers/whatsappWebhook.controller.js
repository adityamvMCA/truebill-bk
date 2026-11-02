const crypto = require("crypto");
const MessageLog = require("../models/MessageLog");
const MessageTemplate = require("../models/MessageTemplate");
const MessagingSettings = require("../models/MessagingSettings");

/* Meta calls this once when you register the webhook URL */
exports.verify = (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
};

const validSignature = (req) => {
  const signature = req.get("x-hub-signature-256") || "";
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", process.env.META_APP_SECRET).update(req.body).digest("hex");

  return (
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
};

const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

exports.receive = async (req, res) => {
  /* req.body is a raw Buffer here (see route setup) */
  if (!validSignature(req)) return res.sendStatus(401);

  res.sendStatus(200); // answer fast, process after

  try {
    const payload = JSON.parse(req.body.toString("utf8"));

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        /* Message status + pricing */
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

        /* Template approval updates */
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