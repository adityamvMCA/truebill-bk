const graph = () =>
  `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v21.0"}`;

const httpError = (message, statusCode = 400, extra = {}) =>
  Object.assign(new Error(message), { statusCode, retryable: false, ...extra });

/*
 * creds = { token, phoneId } loaded per tenant from MessagingSettings.
 * Falls back to .env so nothing breaks if a tenant has no saved credentials.
 */
const credentials = (creds) => {
  const token = creds?.token || process.env.WHATSAPP_TOKEN;
  const phoneId = creds?.phoneId || process.env.PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    throw httpError("WhatsApp credentials are not configured for this business", 400);
  }
  return { token, phoneId };
};

/* 9876543210 -> 919876543210 */
const normalizePhone = (value, defaultCountry = "91") => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = defaultCountry + digits;
  if (digits.length < 11 || digits.length > 15) {
    throw httpError("Invalid WhatsApp phone number");
  }
  return digits;
};

const callGraph = async (path, init = {}, creds) => {
  const { token } = credentials(creds);
  const response = await fetch(`${graph()}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw httpError(
      data?.error?.error_user_msg || data?.error?.message || "WhatsApp request failed",
      retryable ? 502 : 400,
      { retryable, meta: data?.error },
    );
  }
  return data;
};

/* Upload a file to WhatsApp. Returns a media id valid for 30 days. */
const uploadMedia = async ({ buffer, filename, mimeType = "application/pdf", creds }) => {
  const { phoneId } = credentials(creds);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const data = await callGraph(`${phoneId}/media`, { method: "POST", body: form }, creds);
  if (!data.id) throw httpError("WhatsApp media upload failed", 502, { retryable: true });
  return data.id;
};

const headerComponent = (header) => {
  if (!header) return null;
  const media = header.id ? { id: header.id } : { link: header.link };
  if (header.type === "document") media.filename = header.filename || "document.pdf";
  return { type: "header", parameters: [{ type: header.type, [header.type]: media }] };
};

/**
 * Send any approved template.
 *
 * sendTemplate({
 *   to, templateName, language = "en",
 *   bodyVariables: ["a", "b"],                 // {{1}}, {{2}} ...
 *   header: { type: "document" | "image" | "video", id | link, filename },
 *   urlButtonParams: ["token"],                // dynamic URL buttons, in order
 *   creds: { token, phoneId },                 // optional, per tenant
 * }) -> { messageId, to }
 */
const sendTemplate = async ({
  to,
  templateName,
  language = "en",
  bodyVariables = [],
  header,
  urlButtonParams = [],
  creds,
}) => {
  if (!templateName) throw httpError("templateName is required");
  const { phoneId } = credentials(creds);
  const recipient = normalizePhone(to);

  const components = [];
  const head = headerComponent(header);
  if (head) components.push(head);

  if (bodyVariables.length) {
    components.push({
      type: "body",
      parameters: bodyVariables.map((v) => ({
        type: "text",
        // Meta rejects empty values, newlines and repeated spaces
        text: String(v ?? "-").replace(/\s+/g, " ").trim() || "-",
      })),
    });
  }

  urlButtonParams.forEach((param, index) => {
    components.push({
      type: "button",
      sub_type: "url",
      index: String(index),
      parameters: [{ type: "text", text: String(param) }],
    });
  });

  const data = await callGraph(
    `${phoneId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      }),
    },
    creds,
  );

  return { messageId: data?.messages?.[0]?.id, to: recipient };
};

module.exports = { sendTemplate, uploadMedia, normalizePhone, httpError, callGraph };
