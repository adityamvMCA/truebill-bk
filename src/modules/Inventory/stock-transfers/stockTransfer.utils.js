const { createHash } = require("node:crypto");
const createError = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
const text = (value) => String(value ?? "").trim();
const scaled = (value, scale, min, max, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw createError(`${label} is outside the supported range`);
  const raw = value * scale;
  const rounded = Math.round(raw);
  if (!Number.isSafeInteger(rounded) || Math.abs(raw - rounded) > 0.000001) throw createError(`${label} has too many decimal places`);
  return rounded;
};
const quantityMilli = (value) => scaled(value, 1000, 0.001, 1000000, "Quantity");
const balanceMilli = (value) => scaled(value, 1000, 0, Number.MAX_SAFE_INTEGER / 1000, "Stock balance");
const ratePaise = (value) => scaled(value, 100, 0, 1000000000, "Product purchase price");
const valuePaise = (quantity, rate) => {
  const value = (BigInt(quantity) * BigInt(rate) + 500n) / 1000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw createError("Transfer reference value exceeds the supported range");
  return Number(value);
};
const requestHash = (payload) => createHash("sha256").update(JSON.stringify({
  fromWarehouseId: String(payload.fromWarehouseId),
  toWarehouseId: String(payload.toWarehouseId),
  transferDate: payload.transferDate.toISOString(),
  notes: payload.notes,
  items: payload.items.map((item) => ({ productId: String(item.productId), quantityMilli: quantityMilli(item.quantity) })).sort((a, b) => a.productId.localeCompare(b.productId)),
})).digest("hex");
const publicTransfer = (document) => {
  const data = typeof document?.toObject === "function" ? document.toObject() : { ...document };
  delete data.requestHash;
  return data;
};
module.exports = { createError, text, quantityMilli, balanceMilli, ratePaise, valuePaise, requestHash, publicTransfer };
