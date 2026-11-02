// src/controllers/share.controller.js

const mongoose = require("mongoose");

const MessageLog = require("../models/MessageLog");
const MessageTemplate = require("../models/MessageTemplate");
const MessagingSettings = require("../models/MessagingSettings");

const wa = require("../services/whatsapp");
const { sendMail } = require("../services/mailer");

const { buildInvoicePdf, buildSamplePdf } = require("../services/invoicePdf");

const T = require("../services/templateRender");

// Invoices live in per-tenant databases, NOT the default connection.
const { getReadyTenantConnection } = require("../tenancy/tenantConnectionManager");
const { getTenantAccountingModels } = require("../tenancy/tenantAccountingModels");

/* ================================================================
   HELPERS
================================================================ */

const fail = (http, message) => Object.assign(new Error(message), { http });

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error("Share controller error:", error);

    if (res.headersSent) {
      return next(error);
    }

    return res.status(error.http || error.statusCode || 500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value));

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * Resolve the tenant for this request.
 *
 * resolveTenant middleware sets req.tenant (works for both tenant users
 * and platform users who selected a tenant). Prefer it, and verify it
 * against the token tenant for tenant users.
 */
const getTenantId = (req) => {
  const authTenantId = req.user?.tenantId;
  const resolvedTenantId = req.tenant?._id ?? req.tenant?.id ?? req.tenantId;

  if (
    authTenantId &&
    resolvedTenantId &&
    String(authTenantId) !== String(resolvedTenantId)
  ) {
    throw fail(403, "Tenant context mismatch");
  }

  const tenantId =
    resolvedTenantId ||
    authTenantId ||
    req.headers?.["x-tenant-id"] ||
    req.headers?.["x-selected-tenant-id"] ||
    req.query?.tenantId;

  if (!tenantId) {
    throw fail(400, "Tenant context is missing");
  }

  if (!isObjectId(tenantId)) {
    throw fail(400, "Invalid tenant ID");
  }

  return toObjectId(tenantId);
};

/**
 * Get the SalesInvoice model bound to the tenant's own connection.
 */
const getSalesInvoiceModel = (req) => {
  if (!req.tenant) {
    throw fail(
      400,
      "Tenant context is missing. Ensure resolveTenant runs on /api/share.",
    );
  }

  const connection = getReadyTenantConnection(req.tenant);
  const models = getTenantAccountingModels(connection);

  if (!models?.SalesInvoice || models.SalesInvoice.db !== connection) {
    throw fail(500, "Sales invoice model is unavailable for this tenant");
  }

  return models.SalesInvoice;
};

const getUserId = (req) => {
  const userId = req.user?.userId || req.user?._id || req.user?.id;

  if (!userId || !isObjectId(userId)) {
    return undefined;
  }

  return toObjectId(userId);
};

const getSettings = async (tenantId) => {
  let settings = await MessagingSettings.findOne({ tenantId });

  if (!settings) {
    settings = await MessagingSettings.create({ tenantId });
  }

  return settings;
};

const estimateCostPaise = (settings, channel, kind) => {
  if (settings.mode !== "business") {
    return 0;
  }

  // Assumes configured rates are in rupees.
  return Math.round(Number(settings.rates?.[channel]?.[kind] || 0) * 100);
};

const periodStart = (key) => {
  const now = new Date();

  if (key === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (key === "7d") {
    return new Date(now.getTime() - 7 * 86400000);
  }

  if (key === "30d") {
    return new Date(now.getTime() - 30 * 86400000);
  }

  return null;
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeInvoiceNumber = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

/**
 * Find an invoice inside the tenant's own database.
 *
 * 1. Try invoiceId.
 * 2. If that misses and an invoiceNumber was sent, fall back to
 *    invoiceNumber, so a stale id does not block sending.
 */
const findInvoiceForShare = async ({
  SalesInvoice,
  tenantId,
  invoiceId,
  invoiceNumber,
}) => {
  const number = normalizeInvoiceNumber(invoiceNumber);

  if (!invoiceId && !number) {
    throw fail(400, "Invoice ID or invoice number is required");
  }

  if (invoiceId && !isObjectId(invoiceId)) {
    throw fail(400, "Invalid invoice ID");
  }

  let invoice = null;

  if (invoiceId) {
    invoice = await SalesInvoice.findOne({
      _id: toObjectId(invoiceId),
      tenantId,
      isDeleted: { $ne: true },
    }).lean();

    if (
      invoice &&
      number &&
      normalizeInvoiceNumber(invoice.invoiceNumber) !== number
    ) {
      throw fail(400, "Invoice ID and invoice number do not match");
    }
  }

  if (!invoice && number) {
    invoice = await SalesInvoice.findOne({
      tenantId,
      invoiceNumber: number,
      isDeleted: { $ne: true },
    }).lean();
  }

  if (!invoice) {
    console.warn("Share: invoice not found", {
      tenantId: String(tenantId),
      invoiceId: invoiceId ? String(invoiceId) : undefined,
      invoiceNumber: number || undefined,
    });

    throw fail(404, "Invoice not found for the selected tenant.");
  }

  return invoice;
};

/* ================================================================
   SEND EMAIL / WHATSAPP
================================================================ */

exports.send = wrap(async (req, res) => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const SalesInvoice = getSalesInvoiceModel(req);

  const {
    invoiceId,
    invoiceNumber,
    channel,
    kind,
    to,
    subject,
    message,
    templateId,
  } = req.body || {};

  /* ---------- VALIDATION ---------- */

  if (!["whatsapp", "email"].includes(channel)) {
    throw fail(400, "Invalid channel. Use whatsapp or email.");
  }

  if (!["invoice", "reminder", "message"].includes(kind)) {
    throw fail(400, "Invalid message kind.");
  }

  if (!to || !String(to).trim()) {
    throw fail(400, "Recipient is required");
  }

  if (!invoiceId && !invoiceNumber) {
    throw fail(400, "Invoice ID or invoice number is required");
  }

  if (
    channel === "email" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())
  ) {
    throw fail(400, "Enter a valid recipient email address");
  }

  /* ---------- FETCH INVOICE ---------- */

  const invoice = await findInvoiceForShare({
    SalesInvoice,
    tenantId,
    invoiceId,
    invoiceNumber,
  });

  if (invoice.status === "CANCELLED") {
    throw fail(400, "Invoice is cancelled");
  }

  if (
    kind === "reminder" &&
    (invoice.status !== "POSTED" || invoice.paymentStatus === "PAID")
  ) {
    throw fail(400, "Reminders are only for posted, unpaid invoices");
  }

  /* ---------- SETTINGS ---------- */

  const settings = await getSettings(tenantId);

  /* ---------- TEMPLATE ---------- */

  let template = null;

  if (templateId) {
    if (!isObjectId(templateId)) {
      throw fail(400, "Invalid template ID");
    }

    template = await MessageTemplate.findOne({
      _id: templateId,
      tenantId,
      channel,
      isDeleted: false,
    }).lean();

    if (!template) {
      throw fail(404, "Template not found");
    }
  }

  if (template && channel === "whatsapp" && template.status !== "APPROVED") {
    throw fail(
      400,
      `Template is ${template.status}. Only approved templates can be sent.`,
    );
  }

  /* ---------- CREATE MESSAGE LOG ---------- */

  const log = await MessageLog.create({
    tenantId,
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    customerCode: invoice.customerCode,
    customerName: invoice.customerName,
    channel,
    kind,
    to: String(to).trim(),
    subject: subject || undefined,

    // Email is sent through backend SMTP.
    mode: channel === "email" ? "business" : settings.mode,

    templateName: template?.name,
    sentBy: userId,

    status: "queued",
    costPaise: 0,
    billable: false,
  });

  try {
    /* ---------- TEMPLATE VARIABLES ---------- */

    const values = T.buildValues(invoice);

    /* ---------- GENERATE PDF ---------- */

    const wantsPdf = kind === "invoice" || Boolean(template?.attachPdf);

    const pdf = wantsPdf ? await buildInvoicePdf(invoice) : null;

    if (wantsPdf && !pdf) {
      throw new Error("Invoice PDF generation failed");
    }

    const filename = `${invoice.invoiceNumber}.pdf`;

    let providerId;

    if (channel === "email") {
      /* ============================================================
         EMAIL SENDING - GMAIL SMTP
      ============================================================ */

      if (!process.env.MAIL_EMAIL || !process.env.MAIL_PASSWORD) {
        throw new Error("Email service is not configured on the server");
      }

      const renderedSubject = template?.subject
        ? T.renderNamed(template.subject, values)
        : subject || `Invoice ${invoice.invoiceNumber} from TrustIQ`;

      const renderedText = template
        ? T.renderNamed(template.body, values)
        : message || `Please find attached invoice ${invoice.invoiceNumber}.`;

      providerId = await sendMail({
        to: String(to).trim(),
        subject: renderedSubject,
        text: renderedText,
        attachments: pdf
          ? [
              {
                filename,
                content: pdf,
                contentType: "application/pdf",
              },
            ]
          : [],
      });

      // SMTP accepted the message. This does not guarantee inbox delivery.
      log.status = "sent";
      log.billable = false;
      log.costPaise = 0;
    } else {
      /* ============================================================
         WHATSAPP SENDING
      ============================================================ */

      const mediaId = pdf ? await wa.uploadMedia(pdf, filename) : undefined;

      if (template) {
        providerId = await wa.sendTemplate({
          to,
          name: template.name,
          language: template.language,
          mediaId,
          filename,
          params: (template.variableKeys || []).map(
            (key) => values[key] ?? "",
          ),
        });
      } else if (mediaId) {
        providerId = await wa.sendDocument({
          to,
          mediaId,
          filename,
          caption: message || "",
        });
      } else {
        providerId = await wa.sendText({
          to,
          text: message || "",
        });
      }

      log.status = "sent";
      log.billable = settings.mode === "business";
      log.costPaise = log.billable
        ? estimateCostPaise(settings, channel, kind)
        : 0;
    }

    /* ---------- SAVE MESSAGE STATUS ---------- */

    log.providerMessageId = providerId || undefined;

    await log.save();

    return res.json({
      success: true,
      message:
        channel === "email"
          ? "Email accepted by SMTP service"
          : "WhatsApp message accepted by provider",
      data: {
        id: log._id,
        status: log.status,
        providerMessageId: log.providerMessageId,
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        attachment: Boolean(pdf),
      },
    });
  } catch (error) {
    log.status = "failed";
    log.error = error.message;
    log.billable = false;
    log.costPaise = 0;

    await log.save();

    const hint =
      error.code === 131047
        ? "Customer has not messaged in 24 hours. Use an approved WhatsApp template."
        : error.message || "Unable to send message";

    throw fail(error.status === 401 ? 502 : 400, hint);
  }
});

/* ================================================================
   STATISTICS
================================================================ */

exports.stats = wrap(async (req, res) => {
  const tenantId = getTenantId(req);
  const start = periodStart(req.query.period || "30d");

  const match = {
    tenantId,
    ...(start ? { createdAt: { $gte: start } } : {}),
  };

  const rows = await MessageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          channel: "$channel",
          kind: "$kind",
          status: "$status",
          mode: "$mode",
        },
        count: { $sum: 1 },
        cost: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$status", "failed"] },
                  { $eq: ["$billable", true] },
                  { $eq: ["$mode", "business"] },
                ],
              },
              "$costPaise",
              0,
            ],
          },
        },
      },
    },
  ]);

  const out = {
    total: 0,
    whatsapp: 0,
    email: 0,
    failed: 0,
    delivered: 0,
    read: 0,
    businessCount: 0,
    manualCount: 0,
    spendPaise: 0,
    breakdown: {},
  };

  for (const { _id: key, count, cost } of rows) {
    if (key.status === "failed") {
      out.failed += count;
      continue;
    }

    out.total += count;

    if (key.channel === "whatsapp" || key.channel === "email") {
      out[key.channel] += count;
    }

    if (key.status === "delivered") {
      out.delivered += count;
    }

    if (key.status === "read") {
      out.read += count;
      out.delivered += count;
    }

    if (key.mode === "business") {
      out.businessCount += count;
    } else {
      out.manualCount += count;
    }

    out.spendPaise += cost;

    const breakdownKey = `${key.channel}:${key.kind}`;

    if (!out.breakdown[breakdownKey]) {
      out.breakdown[breakdownKey] = {
        channel: key.channel,
        kind: key.kind,
        count: 0,
        costPaise: 0,
      };
    }

    out.breakdown[breakdownKey].count += count;
    out.breakdown[breakdownKey].costPaise += cost;
  }

  out.averagePaise = out.businessCount
    ? Math.round(out.spendPaise / out.businessCount)
    : 0;

  out.breakdown = Object.values(out.breakdown).sort(
    (a, b) => b.count - a.count,
  );

  return res.json({ success: true, data: out });
});

/* ================================================================
   MESSAGE LOGS
================================================================ */

exports.logs = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const start = periodStart(req.query.period || "30d");

  const filter = {
    tenantId,
    ...(start ? { createdAt: { $gte: start } } : {}),
  };

  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), "i");

    filter.$or = [
      { customerName: rx },
      { customerCode: rx },
      { invoiceNumber: rx },
      { to: rx },
    ];
  }

  const [data, total] = await Promise.all([
    MessageLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    MessageLog.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/* ================================================================
   SETTINGS
================================================================ */

exports.getSettings = wrap(async (req, res) => {
  const tenantId = getTenantId(req);
  const settings = await getSettings(tenantId);

  return res.json({ success: true, data: settings });
});

exports.saveSettings = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  const { mode, provider, businessNumber, rates } = req.body || {};

  const settings = await getSettings(tenantId);

  if (mode !== undefined) {
    if (!["business", "manual"].includes(mode)) {
      throw fail(400, "Invalid messaging mode");
    }

    settings.mode = mode;
  }

  if (provider !== undefined) {
    settings.provider = provider;
  }

  if (businessNumber !== undefined) {
    settings.businessNumber = businessNumber;
  }

  if (rates !== undefined) {
    settings.rates = rates;
  }

  await settings.save();

  return res.json({ success: true, data: settings });
});

/* ================================================================
   LIST TEMPLATES
================================================================ */

exports.listTemplates = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  const filter = { tenantId, isDeleted: false };

  if (req.query.channel) {
    filter.channel = req.query.channel;
  }

  if (req.query.kind) {
    filter.kind = req.query.kind;
  }

  const data = await MessageTemplate.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    data,
    variables: Object.keys(T.VARIABLES),
  });
});

/* ================================================================
   CREATE TEMPLATE
================================================================ */

exports.createTemplate = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  const {
    label,
    channel,
    kind,
    body,
    subject,
    language = "en",
    category = "UTILITY",
    attachPdf = false,
  } = req.body || {};

  if (!label || !body) {
    throw fail(400, "Template name and message body are required");
  }

  if (!["whatsapp", "email"].includes(channel)) {
    throw fail(400, "Invalid channel");
  }

  if (!["invoice", "reminder", "message"].includes(kind)) {
    throw fail(400, "Invalid template kind");
  }

  const variableKeys = T.keysIn(body);

  const unknown = variableKeys.filter((key) => !T.VARIABLES[key]);

  if (unknown.length) {
    throw fail(400, `Unknown variables: ${unknown.join(", ")}`);
  }

  const name = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);

  if (!name) {
    throw fail(400, "Template name is invalid");
  }

  const doc = {
    tenantId,
    label,
    name,
    channel,
    kind,
    language,
    category,
    subject,
    body,
    variableKeys,
    attachPdf: Boolean(attachPdf),
    status: channel === "email" ? "APPROVED" : "DRAFT",
    isDeleted: false,
  };

  if (channel === "whatsapp") {
    if (/^\s*{{/.test(body) || /}}\s*$/.test(body)) {
      throw fail(
        400,
        "A WhatsApp template cannot start or end with a variable. Add text around it.",
      );
    }

    const headerHandle = attachPdf
      ? await wa.uploadSampleHandle(await buildSamplePdf())
      : undefined;

    const result = await wa.createTemplate({
      name,
      category,
      language,
      bodyText: T.toPositional(body, variableKeys),
      examples: variableKeys.map((key) => T.SAMPLES[key]),
      headerHandle,
    });

    doc.metaTemplateId = result.id;

    doc.status = String(result.status || "PENDING").toUpperCase();
  }

  try {
    const saved = await MessageTemplate.create(doc);

    return res.status(201).json({ success: true, data: saved });
  } catch (error) {
    if (error.code === 11000) {
      throw fail(409, "A template with this name already exists");
    }

    throw error;
  }
});

/* ================================================================
   SYNC WHATSAPP TEMPLATE STATUS
================================================================ */

exports.syncTemplate = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  if (!isObjectId(req.params.id)) {
    throw fail(400, "Invalid template ID");
  }

  const template = await MessageTemplate.findOne({
    _id: req.params.id,
    tenantId,
    isDeleted: false,
  });

  if (!template) {
    throw fail(404, "Template not found");
  }

  if (template.channel !== "whatsapp") {
    return res.json({ success: true, data: template });
  }

  const remote = await wa.getTemplateStatus(template.name);

  if (remote) {
    template.status = String(remote.status || "PENDING").toUpperCase();

    template.rejectedReason =
      remote.rejected_reason && remote.rejected_reason !== "NONE"
        ? remote.rejected_reason
        : undefined;

    await template.save();
  }

  return res.json({ success: true, data: template });
});

/* ================================================================
   DELETE TEMPLATE
================================================================ */

exports.deleteTemplate = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  if (!isObjectId(req.params.id)) {
    throw fail(400, "Invalid template ID");
  }

  const template = await MessageTemplate.findOne({
    _id: req.params.id,
    tenantId,
    isDeleted: false,
  });

  if (!template) {
    throw fail(404, "Template not found");
  }

  if (template.channel === "whatsapp" && template.status !== "DRAFT") {
    await wa.deleteTemplate(template.name).catch((error) => {
      console.warn("Meta template delete failed:", error.message);
    });
  }

  template.isDeleted = true;
  template.name = `${template.name}__deleted_${Date.now()}`;

  await template.save();

  return res.json({ success: true, message: "Template deleted" });
});

/* ================================================================
   PREVIEW TEMPLATE
================================================================ */

exports.previewTemplate = wrap(async (req, res) => {
  const tenantId = getTenantId(req);

  const { invoiceId, invoiceNumber, body, subject } = req.body || {};

  let invoice = null;

  if (invoiceId || invoiceNumber) {
    invoice = await findInvoiceForShare({
      SalesInvoice: getSalesInvoiceModel(req),
      tenantId,
      invoiceId,
      invoiceNumber,
    });
  }

  const values = invoice ? T.buildValues(invoice) : T.SAMPLES;

  return res.json({
    success: true,
    data: {
      body: T.renderNamed(body || "", values),
      subject: T.renderNamed(subject || "", values),
    },
  });
});