const { normText, normSupplierName, similarity } = require("./billScan.normalize");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STOP_WORDS = new Set(["and", "the", "for", "with", "pvt", "ltd", "private", "limited", "llp", "inc", "co"]);

const tokensOf = (value) =>
  normText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const SUPPLIER_FIELDS =
  "supplierName supplierCode gstNo ledgerId status paymentTerms creditDays phone email billingAddress city state pincode";

const PRODUCT_FIELDS = "name productCode unit hsnSacCode gstRate purchasePrice type trackInventory";

const pickSupplier = (row) => ({
  _id: row._id,
  supplierName: row.supplierName,
  supplierCode: row.supplierCode,
  gstNo: row.gstNo || null,
  ledgerId: row.ledgerId || null,
  status: row.status,
  paymentTerms: row.paymentTerms || null,
  creditDays: row.creditDays || 0,
  phone: row.phone || null,
  email: row.email || null,
  billingAddress: row.billingAddress || null,
  city: row.city || null,
  state: row.state || null,
  pincode: row.pincode || null,
});

const matchSupplier = async ({ models, tenantId, supplier }) => {
  const warnings = [];
  const conditions = [];

  tokensOf(supplier.name)
    .slice(0, 4)
    .forEach((token) => conditions.push({ supplierName: new RegExp(escapeRegex(token), "i") }));

  if (supplier.gstin) conditions.push({ gstNo: supplier.gstin });

  if (!conditions.length) {
    return { status: "NEW", supplier: null, candidates: [], warnings };
  }

  const rows = await models.Supplier.find({
    tenantId,
    isDeleted: false,
    $or: conditions,
  })
    .select(SUPPLIER_FIELDS)
    .limit(40)
    .lean();

  const scored = rows
    .map((row) => ({
      row,
      byGstin: Boolean(supplier.gstin) && String(row.gstNo || "").toUpperCase() === supplier.gstin,
      score: similarity(supplier.name, row.supplierName, normSupplierName),
    }))
    .sort((a, b) => Number(b.byGstin) - Number(a.byGstin) || b.score - a.score);

  const active = scored.filter((entry) => entry.row.status === "Active");
  const inactiveHit = scored.find(
    (entry) => entry.row.status !== "Active" && (entry.byGstin || entry.score >= 0.92),
  );

  if (inactiveHit) {
    warnings.push(
      `A matching supplier "${inactiveHit.row.supplierName}" exists but is inactive. Reactivate it or choose another supplier.`,
    );
  }

  const candidates = active.slice(0, 3).map((entry) => ({
    ...pickSupplier(entry.row),
    score: Number(entry.score.toFixed(2)),
  }));

  const best = active[0];

  if (best?.byGstin) {
    return { status: "MATCHED_GSTIN", supplier: pickSupplier(best.row), candidates, warnings };
  }

  if (best && best.score >= 0.92) {
    return { status: "MATCHED_NAME", supplier: pickSupplier(best.row), candidates, warnings };
  }

  if (best && best.score >= 0.7) {
    return { status: "SUGGESTED", supplier: null, candidates, warnings };
  }

  return { status: "NEW", supplier: null, candidates: [], warnings };
};

const matchProduct = async ({ Product, tenantId, item }) => {
  const conditions = tokensOf(item.description)
    .slice(0, 4)
    .map((token) => ({ name: new RegExp(escapeRegex(token), "i") }));

  if (item.hsnSac) conditions.push({ hsnSacCode: item.hsnSac });

  if (!conditions.length) return { status: "NEW", product: null, candidates: [] };

  const rows = await Product.find({
    tenantId,
    isDeleted: false,
    status: "ACTIVE",
    $or: conditions,
  })
    .select(PRODUCT_FIELDS)
    .limit(60)
    .lean();

  const scored = rows
    .map((row) => ({
      row,
      score: Math.min(
        1,
        similarity(item.description, row.name) +
          (item.hsnSac && row.hsnSacCode === item.hsnSac ? 0.05 : 0),
      ),
    }))
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const candidates = scored.map((entry) => ({
    _id: entry.row._id,
    name: entry.row.name,
    productCode: entry.row.productCode,
    unit: entry.row.unit,
    hsnSacCode: entry.row.hsnSacCode || null,
    gstRate: entry.row.gstRate,
    purchasePrice: entry.row.purchasePrice,
    type: entry.row.type,
    trackInventory: entry.row.trackInventory,
    score: Number(entry.score.toFixed(2)),
  }));

  if (candidates[0] && candidates[0].score >= 0.85) {
    return { status: "MATCHED", product: candidates[0], candidates };
  }

  return { status: candidates.length ? "SIMILAR" : "NEW", product: null, candidates };
};

const matchProducts = async ({ models, tenantId, items }) => {
  const results = new Array(items.length);

  for (let start = 0; start < items.length; start += 10) {
    const slice = items.slice(start, start + 10);

    const batch = await Promise.all(
      slice.map((item) => matchProduct({ Product: models.Product, tenantId, item })),
    );

    batch.forEach((result, offset) => {
      results[start + offset] = result;
    });
  }

  return results;
};

const findDuplicateBill = async ({ models, tenantId, supplierId, invoiceNumber }) => {
  if (!supplierId || !invoiceNumber) return null;

  const bill = await models.PurchaseBill.findOne({
    tenantId,
    supplierId,
    supplierInvoiceNumberNormalized: String(invoiceNumber).trim().toUpperCase(),
    isDeleted: false,
  })
    .select("billNumber")
    .lean();

  return bill ? { billNumber: bill.billNumber } : null;
};

module.exports = { matchSupplier, matchProducts, findDuplicateBill, escapeRegex };
