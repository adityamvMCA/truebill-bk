const mongoose = require("mongoose");
const { getReadyTenantConnection } = require("../../tenancy/tenantConnectionManager");
const { getTenantAccountingModels } = require("../../tenancy/tenantAccountingModels");
const barcodeSvc = require("./barcode.service");
const sessionSvc = require("./scanSession.service");

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

const ctxOf = (req) => {
  if (!req.tenant?._id) throw err("Resolved tenant context is required", 500);
  const connection = getReadyTenantConnection(req.tenant);
  const models = getTenantAccountingModels(connection);
  return { connection, models, tenantId: req.tenant._id, userId: req.user.userId };
};
const h = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const oid = (v, label) => { if (!mongoose.isObjectIdOrHexString(v)) throw err(`${label} must be a valid ObjectId`); return v; };

const lookup = h(async (req, res) => {
  const { models, tenantId } = ctxOf(req);
  const found = await barcodeSvc.lookupBarcode({ models, tenantId, barcode: req.params.barcode });
  if (!found) return res.status(404).json({ success: false, message: "Barcode not registered" });
  res.json({ success: true, data: found });
});

const catalog = h(async (req, res) => {
  const { models, tenantId } = ctxOf(req);
  const data = await barcodeSvc.catalogPage({ models, tenantId, after: req.query.after, limit: req.query.limit });
  res.json({ success: true, ...data });
});

const register = h(async (req, res) => {
  const { models, tenantId, userId } = ctxOf(req);
  const doc = await barcodeSvc.registerBarcode({ models, tenantId, userId, ...req.body });
  res.status(201).json({ success: true, message: "Barcode registered", data: doc });
});

const generateInternal = h(async (req, res) => {
  const { models, connection, tenantId, userId } = ctxOf(req);
  const productId = oid(req.params.productId, "productId");
  const product = await models.Product.findOne({ _id: productId, tenantId, isDeleted: false }, { unit: 1 }).lean();
  if (!product) throw err("Product not found", 404);
  const barcode = await barcodeSvc.generateInternalBarcode({ connection, tenantId });
  const doc = await barcodeSvc.registerBarcode({
    models, tenantId, userId, productId, barcode, source: "INTERNAL", barcodeType: "CODE128",
    unit: product.unit, ...req.body,
  });
  res.status(201).json({ success: true, message: "Internal barcode generated", data: doc });
});

const byProduct = h(async (req, res) => {
  const { models, tenantId } = ctxOf(req);
  const productId = oid(req.params.productId, "productId");
  const data = await models.ProductBarcode.find({ tenantId, productId }).sort({ isPrimary: -1, createdAt: 1 }).lean();
  res.json({ success: true, data });
});

/** Bulk label data: one label per product (its primary active barcode). */
const labels = h(async (req, res) => {
  const { models, tenantId } = ctxOf(req);
  const ids = req.body.productIds;
  const [rows, products] = await Promise.all([
    models.ProductBarcode.find({ tenantId, productId: { $in: ids }, isActive: true })
      .sort({ isPrimary: -1, createdAt: 1 }).lean(),
    models.Product.find(
      { tenantId, _id: { $in: ids }, isDeleted: false },
      { name: 1, productCode: 1, salePrice: 1 },
    ).lean(),
  ]);
  const pMap = new Map(products.map((p) => [String(p._id), p]));
  const seen = new Set();
  const data = [];
  for (const r of rows) {
    const key = String(r.productId);
    if (seen.has(key) || !pMap.has(key)) continue;
    seen.add(key);
    const p = pMap.get(key);
    data.push({
      name: p.name, sku: p.productCode, barcode: r.barcode, barcodeType: r.barcodeType,
      packagingName: r.packagingName, conversionQuantity: r.conversionQuantity, price: p.salePrice,
    });
  }
  res.json({ success: true, data });
});

const deactivate = h(async (req, res) => {
  const { models, tenantId } = ctxOf(req);
  const r = await models.ProductBarcode.updateOne(
    { _id: oid(req.params.id, "id"), tenantId }, { $set: { isActive: false, isPrimary: false } },
  );
  if (!r.matchedCount) throw err("Barcode not found", 404);
  res.json({ success: true, message: "Barcode deactivated" });
});

const unknownList = h(async (req, res) => {
  const { models, tenantId } = ctxOf(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { tenantId, status: "PENDING" };
  const [data, total] = await Promise.all([
    models.UnknownBarcode.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    models.UnknownBarcode.countDocuments(filter),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

const unknownCreate = h(async (req, res) => {
  const { models, tenantId, userId } = ctxOf(req);
  const { code } = barcodeSvc.validateBarcode(req.body?.barcode);
  await barcodeSvc.recordUnknown({ models, tenantId, userId, barcode: code });
  res.status(202).json({ success: true });
});

/* ---------------- scan sessions ---------------- */
const createSession = h(async (req, res) => {
  const { models, tenantId, userId } = ctxOf(req);
  const { session, joinToken } = await sessionSvc.createSession({ models, tenantId, userId, ...req.body });
  res.status(201).json({
    success: true,
    data: { sessionId: String(session._id), sessionCode: session.sessionCode, expiresAt: session.expiresAt, joinToken },
  });
});

const refreshJoinToken = h(async (req, res) => {
  const { models, tenantId, userId } = ctxOf(req);
  const s = await sessionSvc.getOwnedSession({ models, tenantId, userId, sessionId: oid(req.params.id, "id") });
  res.json({ success: true, data: { joinToken: sessionSvc.issueJoinToken(s._id, tenantId) } });
});

const sessionItems = h(async (req, res) => {
  const { models, tenantId, userId } = ctxOf(req);
  const sessionId = oid(req.params.id, "id");
  await sessionSvc.getOwnedSession({ models, tenantId, userId, sessionId });
  const data = await sessionSvc.getSessionItems({ models, tenantId, sessionId });
  res.json({ success: true, data });
});

const closeSession = h(async (req, res) => {
  const { models, tenantId, userId } = ctxOf(req);
  await sessionSvc.closeSession({ models, tenantId, userId, sessionId: oid(req.params.id, "id") });
  res.json({ success: true });
});

/** Offline batch upload. Requires the device token issued on a successful socket join. */
const syncScans = h(async (req, res) => {
  const c = ctxOf(req);
  const sessionId = oid(req.params.id, "id");
  const token = req.get("x-scan-device-token");
  if (!token) throw err("Device token required", 401);
  const { session, payload } = await sessionSvc.verifyScanToken({
    models: c.models, tenantId: c.tenantId, userId: c.userId, token,
  });
  if (payload.typ !== "scan-device" || String(session._id) !== sessionId) throw err("Forbidden", 403);

  const io = req.app.get("io");
  const room = sessionSvc.scanRoom(c.tenantId, sessionId);
  const results = [];

  for (const scan of req.body.scans) {
    try {
      const r = await sessionSvc.recordConfirmedScan({
        models: c.models, connection: c.connection, tenantId: c.tenantId,
        userId: c.userId, sessionId, ...scan,
      });
      if (r.status === "OK" && io) io.of("/scanner").to(room).emit("scanner:quantity-updated", { item: r.item, product: r.product });
      results.push({ scanId: scan.scanId, status: r.status });
    } catch (e) {
      results.push({ scanId: scan.scanId, status: "ERROR", message: e.message });
    }
  }
  res.json({ success: true, results });
});

module.exports = {
  lookup, catalog, register, generateInternal, byProduct, labels, deactivate, unknownList, unknownCreate,
  createSession, refreshJoinToken, sessionItems, closeSession, syncScans,
};