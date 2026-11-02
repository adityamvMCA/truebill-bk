const BASE = () => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}`;
const auth = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });

class WhatsAppError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const graph = async (path, { method = "POST", json, body, headers = {} } = {}) => {
  const response = await fetch(`${BASE()}${path}`, {
    method,
    headers: { ...auth(), ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const e = data?.error || {};
    throw new WhatsAppError(
      e.error_user_msg || e.message || "WhatsApp request failed",
      e.code,
      response.status,
    );
  }
  return data;
};

const sendRaw = (payload) =>
  graph(`/${process.env.PHONE_NUMBER_ID}/messages`, {
    json: { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
  });

const uploadMedia = async (buffer, filename, mime = "application/pdf") => {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const data = await graph(`/${process.env.PHONE_NUMBER_ID}/media`, { body: form });
  return data.id;
};

const idOf = (data) => data?.messages?.[0]?.id;

/* Approved template, optional PDF header, positional body variables */
const sendTemplate = async ({ to, name, language = "en", mediaId, filename, params = [] }) => {
  const components = [];

  if (mediaId) {
    components.push({
      type: "header",
      parameters: [{ type: "document", document: { id: mediaId, filename } }],
    });
  }

  if (params.length) {
    components.push({
      type: "body",
      parameters: params.map((text) => ({ type: "text", text: String(text) })),
    });
  }

  return idOf(
    await sendRaw({
      to,
      type: "template",
      template: { name, language: { code: language }, components },
    }),
  );
};

/* Free-form: only delivered inside the 24h customer-service window */
const sendText = async ({ to, text }) =>
  idOf(await sendRaw({ to, type: "text", text: { body: text, preview_url: false } }));

const sendDocument = async ({ to, mediaId, filename, caption }) =>
  idOf(await sendRaw({ to, type: "document", document: { id: mediaId, filename, caption } }));

/* ---------------- Template management ---------------- */

/* Meta needs an uploaded example file handle for document headers */
const uploadSampleHandle = async (buffer, filename = "sample.pdf") => {
  const session = await fetch(
    `${BASE()}/${process.env.META_APP_ID}/uploads?file_name=${encodeURIComponent(filename)}&file_length=${buffer.length}&file_type=application/pdf`,
    { method: "POST", headers: auth() },
  ).then((r) => r.json());

  if (!session.id) throw new WhatsAppError("Unable to start sample upload", null, 400);

  const uploaded = await fetch(`${BASE()}/${session.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${process.env.WHATSAPP_TOKEN}`, file_offset: "0" },
    body: buffer,
  }).then((r) => r.json());

  if (!uploaded.h) throw new WhatsAppError("Unable to upload the sample PDF", null, 400);
  return uploaded.h;
};

const createTemplate = ({ name, category, language, bodyText, examples, headerHandle }) => {
  const components = [];

  if (headerHandle) {
    components.push({ type: "HEADER", format: "DOCUMENT", example: { header_handle: [headerHandle] } });
  }

  components.push({
    type: "BODY",
    text: bodyText,
    ...(examples.length ? { example: { body_text: [examples] } } : {}),
  });

  return graph(`/${process.env.WABA_ID}/message_templates`, {
    json: { name, category, language, components },
  });
};

const getTemplateStatus = async (name) => {
  const data = await graph(
    `/${process.env.WABA_ID}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,rejected_reason,id`,
    { method: "GET" },
  );
  return data?.data?.[0] || null;
};

const deleteTemplate = (name) =>
  graph(`/${process.env.WABA_ID}/message_templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });

module.exports = {
  WhatsAppError, uploadMedia, sendTemplate, sendText, sendDocument,
  uploadSampleHandle, createTemplate, getTemplateStatus, deleteTemplate,
};