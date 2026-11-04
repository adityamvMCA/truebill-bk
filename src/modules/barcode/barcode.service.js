const mongoose = require("mongoose");
const { getNextSequence } = require("../../utils/sequenceGenerator");

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

const normalize = (v) => String(v ?? "").trim();

/* ---- format validation (GS1 check digit for EAN/UPC) ---- */
const gs1Check = (digits) => {
  const d = digits.split("").map(Number);
  const check = d.pop();
  const sum = d
    .reverse()
    .reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};

const detectType = (code) => {
  if (/^\d{13}$/.test(code) && gs1Check(code)) return "EAN13";
  if (/^\d{12}$/.test(code) && gs1Check(code)) return "UPC_A";
  if (/^\d{8}$/.test(code) && gs1Check(code)) return "EAN8";
  if (/^\d{14}$/.test(code) && gs1Check(code)) return "ITF14";
  if (/^[\x20-\x7E]{1,64}$/.test(code)) return "CODE128";
  return null;
};

const validateBarcode = (raw) => {
  const code = normalize(raw);
  if (!code || code.length > 64) throw err("Invalid barcode length");
  const type = detectType(code);
  if (!type) throw err("Unsupported or invalid barcode format");
  return { code, type };
};

/* ---- lookup: single indexed read, projection only ---- */
const lookupBarcode = async ({ models, tenantId, barcode }) => {
  const { code } = validateBarcode(barcode);
  const map = await models.ProductBarcode.findOne(
    { tenantId, barcode: code, isActive: true },
    { productId: 1, packagingName: 1, conversionQuantity: 1, unit: 1, barcodeType: 1 },
  ).lean();
  if (!map) return null;

  const product = await models.Product.findOne(
    { _id: map.productId, tenantId, isDeleted: false },
    { name: 1, productCode: 1, unit: 1, salePrice: 1, purchasePrice: 1, gstRate: 1, status: 1 },
  ).lean();
  if (!product) return null;
  return { mapping: map, product };
};

/* ---- register (idempotent, tenant-safe) ---- */
const registerBarcode = async ({
  models, tenantId, userId, productId, barcode, source,
  packagingName = "Unit", conversionQuantity = 1, unit = null,
  isPrimary = false, barcodeType, session,
}) => {
  if (!mongoose.isObjectIdOrHexString(productId)) throw err("Invalid productId");
  const { code, type } = validateBarcode(barcode);

  const product = await models.Product.exists({ _id: productId, tenantId, isDeleted: false })
    .session(session || null);
  if (!product) throw err("Product not found", 404);

  try {
    if (isPrimary) {
      await models.ProductBarcode.updateMany(
        { tenantId, productId, isPrimary: true },
        { $set: { isPrimary: false } },
        { session },
      );
    }
    const [doc] = await models.ProductBarcode.create(
      [{
        tenantId, productId, barcode: code,
        barcodeType: barcodeType || type, source, packagingName,
        conversionQuantity, unit, isPrimary, createdBy: userId,
      }],
      { session },
    );
    await models.UnknownBarcode.updateOne(
      { tenantId, barcode: code }, { $set: { status: "RESOLVED" } }, { session },
    );
    return doc;
  } catch (e) {
    if (e.code === 11000) throw err("Barcode already assigned in this tenant", 409);
    throw e;
  }
};

/* ---- internal Code 128 (never presented as GS1) ---- */
const generateInternalBarcode = async ({ connection, tenantId, session }) => {
  const seq = await getNextSequence("BC", String(tenantId), 8, { connection, session });
  return `INT${seq}`; // Code 128 only
};

/* ---- unknown barcode queue ---- */
const recordUnknown = ({ models, tenantId, userId, barcode }) =>
  models.UnknownBarcode.updateOne(
    { tenantId, barcode: normalize(barcode) },
    { $inc: { seenCount: 1 }, $setOnInsert: { firstSeenBy: userId, status: "PENDING" } },
    { upsert: true },
  );

/* ---- catalogue download for on-device cache (1 lakh+ barcodes) ---- */
const catalogPage = async ({ models, tenantId, after, limit = 5000 }) => {
  const size = Math.min(Math.max(Number(limit) || 5000, 100), 10000);
  const filter = { tenantId, isActive: true };
  if (after && mongoose.isObjectIdOrHexString(after)) filter._id = { $gt: after };

  const rows = await models.ProductBarcode.find(filter, {
    barcode: 1, productId: 1, packagingName: 1, conversionQuantity: 1, unit: 1,
  }).sort({ _id: 1 }).limit(size).lean();

  const ids = [...new Set(rows.map((r) => String(r.productId)))];
  const products = await models.Product.find(
    { tenantId, _id: { $in: ids }, isDeleted: false },
    { name: 1, productCode: 1, unit: 1, salePrice: 1, purchasePrice: 1 },
  ).lean();
  const pMap = new Map(products.map((p) => [String(p._id), p]));

  return {
    items: rows
      .filter((r) => pMap.has(String(r.productId)))
      .map((r) => ({ b: r.barcode, pk: r.packagingName, q: r.conversionQuantity, p: pMap.get(String(r.productId)) })),
    nextCursor: rows.length === size ? String(rows[rows.length - 1]._id) : null,
  };
};

module.exports = {
  validateBarcode, lookupBarcode, registerBarcode,
  generateInternalBarcode, recordUnknown, catalogPage,
};
