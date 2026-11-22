const MessageLog = require("../../models/MessageLog");
const MessageTemplate = require("../../models/MessageTemplate");
const MessagingSettings = require("../../models/MessagingSettings");
const {
  sendTemplate,
  uploadMedia,
  normalizePhone,
  httpError,
} = require("../whatsapp.service");
const { decrypt } = require("../documents/secretBox");
const { renderDocumentPdf } = require("./pdfRenderer.service");
const { getDocumentType } = require("./registry");
const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");
const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const inFlight = new Set();

/*
 * Network and browser errors have no statusCode, so they are retryable.
 * Anything explicitly marked retryable:false (config errors, bad token,
 * render failures) is never retried.
 */
const isRetryable = (e) =>
  e.retryable !== false && (e.retryable === true || e.statusCode === undefined);

/* Per-tenant WhatsApp credentials. Returns undefined to fall back to .env */
const loadCreds = (settings) => {
  const encrypted = settings?.whatsapp?.accessToken;
  if (!encrypted) return undefined;
  try {
    return {
      token: decrypt(encrypted),
      phoneId: settings.whatsapp.phoneNumberId,
    };
  } catch {
    throw httpError(
      "Saved WhatsApp token could not be decrypted. Re-enter it in settings.",
      400,
    );
  }
};

/**
 * shareDocumentOnWhatsApp({ tenant, userId, docType, ref, phone?, force?, canRetry? })
 */
const shareDocumentOnWhatsApp = async ({
  tenant,
  userId,
  docType,
  ref,
  phone,
  force = false,
  canRetry = false,
}) => {
  const def = getDocumentType(docType);
  const tenantId = tenant._id ?? tenant.id;
  const models = getTenantAccountingModels(getReadyTenantConnection(tenant));

  const settings = await MessagingSettings.findOne({ tenantId })
    .select("+whatsapp.accessToken")
    .lean();
  if (settings?.mode !== "business") {
    throw httpError("Business API mode is off.", 409);
  }
  const creds = loadCreds(settings);

  const doc = await def.load({ models, tenantId, ref });
  def.assertShareable?.(doc);
  const number = def.number(doc);

  const lockKey = `${tenantId}:${docType}:${number}`;
  if (inFlight.has(lockKey))
    throw httpError("This document is already being sent.", 409);
  inFlight.add(lockKey);

  const logBase = {
    tenantId,
    channel: "whatsapp",
    kind: def.messageKind,
    mode: "business",
    createdBy: userId,
    ...def.logFields(doc),
  };

  let to = phone || "";

  try {
    if (!force) {
      const already = await MessageLog.exists({
        tenantId,
        channel: "whatsapp",
        kind: def.messageKind,
        invoiceNumber: logBase.invoiceNumber,
        status: { $ne: "failed" },
      });
      if (already) throw httpError("Already sent on WhatsApp.", 409);
    }

    const rawPhone = phone || (await def.phone({ models, tenantId, doc }));
    if (!rawPhone) throw httpError("Customer has no phone number saved.");
    to = normalizePhone(rawPhone);

    const template = await MessageTemplate.findOne({
      tenantId,
      channel: "whatsapp",
      name: def.whatsappTemplate,
      isDeleted: false,
    }).lean();

    const values = def.variables(doc, tenant);
    const keys = template?.variableKeys?.length
      ? template.variableKeys
      : def.defaultVariableKeys;

    const pdf = await renderDocumentPdf({ tenantId, docType, ref: number });
    const filename = def.filename(doc);
    const mediaId = await uploadMedia({ buffer: pdf, filename, creds });

    let messageId;
    let bodyVariables = keys.map((k) => values[k]);

    try {
      const sent = await sendTemplate({
        to,
        templateName: def.whatsappTemplate,
        language: template?.language || "en",
        bodyVariables,
        header: { type: "document", id: mediaId, filename },
        creds,
      });
      messageId = sent.messageId;
    } catch (sendErr) {
      // Auto-recover if Meta reports parameter count mismatch (#132000)
      const details = sendErr?.meta?.error_data?.details || sendErr?.message || "";
      const match = details.match(/expected number of params \((\d+)\)/i);
      if (sendErr?.meta?.code === 132000 && match && match[1]) {
        const expectedCount = parseInt(match[1], 10);
        console.warn(
          `[share] Parameter mismatch for ${def.whatsappTemplate}. Auto-adjusting from ${bodyVariables.length} to ${expectedCount}`,
        );
        const adjusted = [...bodyVariables];
        while (adjusted.length < expectedCount) adjusted.push("-");
        if (adjusted.length > expectedCount) adjusted.length = expectedCount;

        const retrySent = await sendTemplate({
          to,
          templateName: def.whatsappTemplate,
          language: template?.language || "en",
          bodyVariables: adjusted,
          header: { type: "document", id: mediaId, filename },
          creds,
        });
        messageId = retrySent.messageId;
      } else {
        throw sendErr;
      }
    }

    const rate = settings?.rates?.whatsapp?.[def.messageKind] ?? 0;
    await MessageLog.create({
      ...logBase,
      to,
      status: "sent",
      providerMessageId: messageId,
      costPaise: Math.round(rate * 100), // the webhook corrects this with real billing
    });

    return { messageId, to };
  } catch (error) {
    // 409 means "already sent / manual mode", which is not a failure
    const willRetry = canRetry && isRetryable(error);
    if (error.statusCode !== 409 && !willRetry) {
      await MessageLog.create({
        ...logBase,
        to,
        status: "failed",
        error: error.message,
        costPaise: 0,
      }).catch(() => {});
    }
    throw error;
  } finally {
    inFlight.delete(lockKey);
  }
};

/* Fire and forget, with 3 attempts. Never affects the caller. */
const RETRY_DELAYS = [0, 15000, 60000];

const queueDocumentShare = (args) => {
  console.log(`[share] queued ${args.docType} ${args.ref}`);

  const attempt = (n) => {
    const last = n === RETRY_DELAYS.length - 1;
    shareDocumentOnWhatsApp({ ...args, canRetry: !last })
      .then((r) => console.log(`[share] SENT ${args.ref} to ${r.to} (${r.messageId})`))
      .catch((error) => {
        if (error.statusCode === 409) {
          console.log(`[share] skipped ${args.ref}: ${error.message}`);
          return;
        }
        if (!last && isRetryable(error)) {
          console.log(`[share] attempt ${n + 1} failed, retrying: ${error.message}`);
          setTimeout(() => attempt(n + 1), RETRY_DELAYS[n + 1]);
          return;
        }
        console.error(`[share] FAILED ${args.ref}:`, error.message);
      });
  };
  setImmediate(() => attempt(0));
};

module.exports = { shareDocumentOnWhatsApp, queueDocumentShare };
