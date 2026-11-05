const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { lookupBarcode, recordUnknown } = require("./barcode.service");

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

const SESSION_TTL_MIN = Number(process.env.SCAN_SESSION_TTL_MIN || 480); // 8h so offline scans can still sync
const JOIN_TTL_SEC = 120; // QR token
const DEVICE_TTL_SEC = 8 * 3600; // issued to a mobile after a successful join

const scanRoom = (tenantId, sessionId) => `scan:${tenantId}:${sessionId}`;

const sign = (typ, sessionId, tenantId, extra, ttl) =>
  jwt.sign({ sid: String(sessionId), tid: String(tenantId), typ, ...extra }, process.env.JWT_SECRET, { expiresIn: ttl });

const issueJoinToken = (sessionId, tenantId) => sign("scan-join", sessionId, tenantId, {}, JOIN_TTL_SEC);
const issueDeviceToken = (sessionId, tenantId, userId) =>
  sign("scan-device", sessionId, tenantId, { uid: String(userId) }, DEVICE_TTL_SEC);

const createSession = async ({ models, tenantId, userId, documentType, documentId = null }) => {
  const sessionCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  const session = await models.ScanSession.create({
    tenantId, createdBy: userId, documentType, documentId, sessionCode,
    expiresAt: new Date(Date.now() + SESSION_TTL_MIN * 60000),
  });
  return { session, joinToken: issueJoinToken(session._id, tenantId) };
};

const verifyScanToken = async ({ models, tenantId, userId, token }) => {
  let p;
  try { p = jwt.verify(token, process.env.JWT_SECRET); } catch { throw err("Invalid or expired token", 401); }
  if (!["scan-join", "scan-device"].includes(p.typ) || p.tid !== String(tenantId)) throw err("Forbidden", 403);
  if (p.typ === "scan-device" && p.uid !== String(userId)) throw err("Forbidden", 403);
  const session = await models.ScanSession.findOne({
    _id: p.sid, tenantId, status: "ACTIVE", expiresAt: { $gt: new Date() },
  }).lean();
  if (!session) throw err("Session expired", 410);
  return { session, payload: p };
};

const getOwnedSession = async ({ models, tenantId, userId, sessionId }) => {
  const s = await models.ScanSession.findOne({
    _id: sessionId, tenantId, createdBy: userId, status: "ACTIVE", expiresAt: { $gt: new Date() },
  }).lean();
  if (!s) throw err("Session not found or expired", 404);
  return s;
};

const getSessionItems = async ({ models, tenantId, sessionId, limit = 500 }) => {
  const items = await models.ScanItem.find({ tenantId, sessionId }).sort({ lastScannedAt: -1 }).limit(limit).lean();
  const ids = items.map((i) => i.productId);
  const products = await models.Product.find(
    { tenantId, _id: { $in: ids } },
    { name: 1, productCode: 1, type: 1, salePrice: 1, purchasePrice: 1, unit: 1, gstRate: 1, status: 1 },
  ).lean();
  const m = new Map(products.map((p) => [String(p._id), p]));
  return items.map((i) => ({ ...i, product: m.get(String(i.productId)) || null }));
};

/** Mobile/desktop CONFIRM. Idempotent by scanId. Negative quantity = undo. */
const recordConfirmedScan = async ({ models, connection, tenantId, userId, sessionId, scanId, barcode, quantity = 1 }) => {
  if (!scanId || String(scanId).length > 64) throw err("scanId required");
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty === 0 || Math.abs(qty) > 1000000) throw err("Invalid quantity");

  const sess = await models.ScanSession.findOne({
    _id: sessionId, tenantId, status: "ACTIVE", expiresAt: { $gt: new Date() },
  }).lean();
  if (!sess) throw err("Session expired", 410);

  const found = await lookupBarcode({ models, tenantId, barcode });
  if (!found) {
    await recordUnknown({ models, tenantId, userId, barcode });
    return { status: "NOT_FOUND", barcode };
  }

  const { mapping, product } = found;
  const baseQty = qty * (mapping.conversionQuantity || 1);
  const dbSession = await connection.startSession();
  let item, duplicate = false;

  try {
    await dbSession.withTransaction(async () => {
      duplicate = false;
      try {
        await models.ScanEvent.create([{ tenantId, sessionId, scanId }], { session: dbSession });
      } catch (e) {
        if (e.code === 11000) { duplicate = true; return; }
        throw e;
      }
      item = await models.ScanItem.findOneAndUpdate(
        { tenantId, sessionId, productId: product._id, packaging: mapping.packagingName },
        {
          $inc: { quantity: baseQty, scanCount: qty > 0 ? 1 : 0 },
          $set: { lastScannedAt: new Date(), barcode, unit: product.unit },
          $setOnInsert: { createdBy: userId },
        },
        { upsert: true, new: true, session: dbSession },
      ).lean();
      if (item.quantity <= 0) {
        await models.ScanItem.deleteOne({ _id: item._id, tenantId }, { session: dbSession });
        item.quantity = 0;
      }
    });
  } finally {
    await dbSession.endSession();
  }

  if (duplicate) {
    const existing = await models.ScanItem.findOne({
      tenantId, sessionId, productId: product._id, packaging: mapping.packagingName,
    }).lean();
    return { status: "DUPLICATE", item: existing, product };
  }
  return { status: "OK", item, product };
};

const setItemQuantity = async ({ models, tenantId, sessionId, itemId, quantity }) => {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q < 0 || q > 1000000) throw err("Invalid quantity");
  const item = await models.ScanItem.findOneAndUpdate(
    { _id: itemId, tenantId, sessionId }, { $set: { quantity: q } }, { new: true },
  ).lean();
  if (!item) throw err("Item not found", 404);
  if (q === 0) await models.ScanItem.deleteOne({ _id: itemId, tenantId });
  return item;
};

const removeScanItem = ({ models, tenantId, sessionId, itemId }) =>
  models.ScanItem.deleteOne({ _id: itemId, tenantId, sessionId });

const closeSession = ({ models, tenantId, userId, sessionId }) =>
  models.ScanSession.updateOne({ _id: sessionId, tenantId, createdBy: userId }, { $set: { status: "CLOSED" } });

module.exports = {
  scanRoom, createSession, issueJoinToken, issueDeviceToken, verifyScanToken, getOwnedSession,
  getSessionItems, recordConfirmedScan, setItemQuantity, removeScanItem, closeSession,
};