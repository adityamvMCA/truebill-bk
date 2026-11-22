const crypto = require("crypto");

const secret = () => {
  if (!process.env.DOC_LINK_SECRET) throw new Error("DOC_LINK_SECRET is missing");
  return process.env.DOC_LINK_SECRET;
};

const sign = (body) =>
  crypto.createHmac("sha256", secret()).update(body).digest("base64url");

const createDocToken = ({ tenantId, docType, ref, ttlMinutes = 90 * 24 * 60 }) => {
  const body = Buffer.from(
    JSON.stringify({
      t: String(tenantId),
      d: docType,
      r: String(ref),
      e: Date.now() + ttlMinutes * 60000,
    }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
};

const verifyDocToken = (token) => {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;

  const expected = sign(body);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.e || p.e < Date.now()) return null;
    return { tenantId: p.t, docType: p.d, ref: p.r };
  } catch {
    return null;
  }
};

module.exports = { createDocToken, verifyDocToken };