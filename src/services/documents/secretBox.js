const crypto = require("crypto");

/*
 * AES-256-GCM encryption for secrets stored in the database.
 * Generate the key once and never change it:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Put it in .env as SETTINGS_ENCRYPTION_KEY (64 hex characters).
 */
const key = () => {
  const hex = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
};

const encrypt = (text) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
};

const decrypt = (payload) => {
  const [iv, tag, enc] = String(payload)
    .split(".")
    .map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
};

module.exports = { encrypt, decrypt };
