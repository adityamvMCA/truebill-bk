const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const purchaseBillService = require("./purchaseBill.service");

/* Adjust these two paths if your folders are named differently. */
const supplierService = require("../suppliers/supplier.service");
const productService = require("../products/product.service");

const config = require("./billScan.config");
const { readFile, ocrImages, tidy } = require("./billScan.extract");
const { extractInvoice } = require("./billScan.llm");
const { normalizeExtraction } = require("./billScan.normalize");
const {
  matchSupplier,
  matchProducts,
  findDuplicateBill,
  escapeRegex,
} = require("./billScan.match");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

let activeScans = 0;

/* ------------------------------------------------------------------ */
/* Scan: read file(s) -> LLM -> normalise -> match. Saves nothing.     */
/* ------------------------------------------------------------------ */

const scanBill = async ({ tenant, files }) => {
  if (!Array.isArray(files) || files.length === 0) {
    throw createError("Upload at least one bill file");
  }

  if (activeScans >= config.maxConcurrentScans) {
    throw createError("The scanner is busy. Please try again in a few seconds.", 429);
  }

  activeScans += 1;

  try {
    const warnings = [];
    const textParts = [];
    let images = [];

    for (const file of files) {
      const result = await readFile(file);

      if (result.text) textParts.push(`--- ${result.name} ---\n${result.text}`);
      if (result.images.length) images.push(...result.images);
    }

    if (images.length > config.maxImages) {
      images = images.slice(0, config.maxImages);
      warnings.push(`Only the first ${config.maxImages} pages/images were scanned.`);
    }

    let documentText = textParts.join("\n\n");
    let method = images.length ? "OCR" : "TEXT";
    let extraction = null;

    if (images.length && config.llm.visionModel) {
      try {
        extraction = await extractInvoice({
          text: documentText.slice(0, config.maxTextChars),
          images,
          model: config.llm.visionModel,
        });
        method = "VISION";
      } catch (error) {
        warnings.push(`The vision model failed (${error.message}). OCR was used instead.`);
      }
    }

    if (!extraction) {
      if (images.length) {
        const ocrText = await ocrImages(images);
        documentText = tidy(`${documentText}\n\n${ocrText}`);
      }

      if (documentText.trim().length < 20) {
        throw createError(
          "No readable text was found in the upload. Try a clearer, well-lit photo or a text-based PDF.",
          422,
        );
      }

      if (documentText.length > config.maxTextChars) {
        documentText = documentText.slice(0, config.maxTextChars);
        warnings.push("The document is long, so only the first part was scanned. Check all items.");
      }

      extraction = await extractInvoice({
        text: documentText,
        images: [],
        model: config.llm.model,
      });
    }

    if (process.env.SCAN_DEBUG === "true") {
      console.log("[billScan] method:", method, "model:", extraction.model);
      console.log("[billScan] text sent:\n", documentText.slice(0, 2500));
      console.log("[billScan] raw model JSON:\n", JSON.stringify(extraction.raw, null, 2).slice(0, 6000));
    }

    const normalized = normalizeExtraction(extraction.raw);
    warnings.push(...normalized.warnings);

    /* Sanity checks: catch lost decimal points and misread/missing lines. */
    const lineSum = normalized.items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const taxableTotal = normalized.totals.taxable;

    if (taxableTotal > 0 && lineSum > 0) {
      const ratio = taxableTotal / lineSum;

      if (ratio > 50 && ratio < 200) {
        warnings.push(
          "The scanned totals look about 100 times larger than the line amounts. A decimal point may have been lost. Compare with the original bill.",
        );
      } else if (Math.abs(ratio - 1) > 0.02) {
        warnings.push(
          "The line amounts do not add up to the bill's taxable total. Some lines may be missing or misread.",
        );
      }
    }

    const connection = getReadyTenantConnection(tenant);
    const models = getTenantAccountingModels(connection);
    const tenantId = tenant._id;

    const supplierMatch = await matchSupplier({
      models,
      tenantId,
      supplier: normalized.supplier,
    });

    warnings.push(...supplierMatch.warnings);

    const productMatches = await matchProducts({
      models,
      tenantId,
      items: normalized.items,
    });

    const items = normalized.items.map((item, index) => ({
      ...item,
      match: productMatches[index],
    }));

    // Two bill lines that resolve to one product cannot be saved (one line per product).
    const seen = new Map();
    items.forEach((item, index) => {
      const id = item.match.product && String(item.match.product._id);
      if (!id) return;

      if (seen.has(id)) {
        warnings.push(
          `Lines ${seen.get(id) + 1} and ${index + 1} match the same product. Merge them into one line before saving.`,
        );
      } else {
        seen.set(id, index);
      }
    });

    const duplicateBill = await findDuplicateBill({
      models,
      tenantId,
      supplierId: supplierMatch.supplier?._id,
      invoiceNumber: normalized.invoice.number,
    });

    if (duplicateBill) {
      warnings.push(
        `This supplier invoice number already exists as ${duplicateBill.billNumber}. Saving will be rejected.`,
      );
    }

    return {
      meta: {
        method,
        model: extraction.model,
        files: files.map((file) => file.originalname),
      },
      supplier: normalized.supplier,
      supplierMatch,
      invoice: normalized.invoice,
      taxMode: normalized.taxMode,
      totals: normalized.totals,
      notes: normalized.notes,
      items,
      duplicateBill,
      warnings,
    };
  } finally {
    activeScans -= 1;
  }
};

/* ------------------------------------------------------------------ */
/* Confirm: create missing supplier/products, then create + post bill  */
/* ------------------------------------------------------------------ */

const compact = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

const findExistingSupplier = async ({ models, tenantId, data }) => {
  const conditions = [];

  if (data.gstNo) conditions.push({ gstNo: String(data.gstNo).toUpperCase() });

  conditions.push({
    supplierName: new RegExp(`^${escapeRegex(data.supplierName.trim())}$`, "i"),
  });

  return models.Supplier.findOne({
    tenantId,
    isDeleted: false,
    $or: conditions,
  })
    .select("supplierName supplierCode status")
    .lean();
};

const resolveSupplier = async ({ models, tenant, tenantId, userId, ipAddress, supplier, warnings, created }) => {
  if (supplier.mode === "EXISTING") return supplier.supplierId;

  const data = supplier.data;
  const existing = await findExistingSupplier({ models, tenantId, data });

  if (existing) {
    if (existing.status !== "Active") {
      throw createError(`Supplier "${existing.supplierName}" already exists but is inactive.`, 409);
    }

    warnings.push(`Supplier "${existing.supplierName}" already existed and was reused.`);
    return existing._id;
  }

  const phone = String(data.phone || "").replace(/\D/g, "");

  const record = await supplierService.createSupplier({
    tenant,
    userId,
    ipAddress,
    payload: compact({
      supplierName: data.supplierName.trim(),
      supplierType: "Business",
      gstNo: data.gstNo ? String(data.gstNo).toUpperCase() : undefined,
      phone: phone.length >= 10 ? phone.slice(-10) : undefined,
      email: data.email ? String(data.email).trim().toLowerCase() : undefined,
      billingAddress: data.billingAddress,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      country: "India",
      paymentTerms: data.paymentTerms || "Due on Receipt",
      creditDays: Number(data.creditDays) || 0,
      creditLimit: 0,
      openingBalance: 0,
      openingBalanceType: "CREDIT",
      status: "Active",
    }),
  });

  created.supplier = {
    _id: record._id,
    supplierCode: record.supplierCode,
    supplierName: record.supplierName,
  };

  return record._id;
};

const createProductSafely = async ({ tenant, userId, ipAddress, data, warnings }) => {
  const base = compact({
    name: data.name.trim(),
    type: data.type || "GOODS",
    unit: data.unit || "NOS",
    hsnSacCode: data.hsnSacCode,
    gstRate: data.gstRate ?? 0,
    purchasePrice: data.purchasePrice ?? 0,
    salePrice: 0,
    openingStock: 0,
    status: "ACTIVE",
  });

  base.trackInventory = base.type === "GOODS";

  try {
    return await productService.createProduct({ tenant, userId, ipAddress, payload: base });
  } catch (error) {
    // The HSN/SAC master may not contain this code. Keep the bill moving, but tell the user.
    if (base.hsnSacCode && /hsn|sac/i.test(error.message || "")) {
      const { hsnSacCode, ...withoutHsn } = base;

      warnings.push(
        `HSN/SAC "${hsnSacCode}" was not accepted for "${base.name}" (${error.message}). The product was created without it.`,
      );

      return productService.createProduct({ tenant, userId, ipAddress, payload: withoutHsn });
    }

    throw createError(
      `Could not create product "${base.name}": ${error.message}`,
      error.statusCode || 400,
    );
  }
};

const resolveProducts = async ({ models, tenant, tenantId, userId, ipAddress, items, warnings, created }) => {
  const newNames = new Set();

  for (const item of items) {
    if (item.product.mode !== "NEW") continue;

    const key = item.product.data.name.trim().toLowerCase();

    if (newNames.has(key)) {
      throw createError(
        `The new product "${item.product.data.name}" appears on more than one line. Merge those lines.`,
      );
    }

    newNames.add(key);
  }

  const productIds = [];

  for (const item of items) {
    if (item.product.mode === "EXISTING") {
      productIds.push(String(item.product.productId));
      continue;
    }

    const data = { ...item.product.data, purchasePrice: item.unitRate };

    const existing = await models.Product.findOne({
      tenantId,
      isDeleted: false,
      name: new RegExp(`^${escapeRegex(data.name.trim())}$`, "i"),
    })
      .select("name productCode status")
      .lean();

    if (existing) {
      if (existing.status !== "ACTIVE") {
        throw createError(`Product "${existing.name}" already exists but is inactive.`, 409);
      }

      warnings.push(`Product "${existing.name}" already existed and was reused.`);
      productIds.push(String(existing._id));
      continue;
    }

    const product = await createProductSafely({ tenant, userId, ipAddress, data, warnings });

    created.products.push({
      _id: product._id,
      productCode: product.productCode,
      name: product.name,
    });

    productIds.push(String(product._id));
  }

  if (new Set(productIds).size !== productIds.length) {
    throw createError("Two lines resolve to the same product. Merge them into one line.");
  }

  return productIds;
};

const confirmScan = async ({ tenant, userId, payload, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);
  const tenantId = tenant._id;

  const warnings = [];
  const created = { supplier: null, products: [] };

  const supplierId = await resolveSupplier({
    models,
    tenant,
    tenantId,
    userId,
    ipAddress,
    supplier: payload.supplier,
    warnings,
    created,
  });

  const productIds = await resolveProducts({
    models,
    tenant,
    tenantId,
    userId,
    ipAddress,
    items: payload.items,
    warnings,
    created,
  });

  const bill = await purchaseBillService.createPurchaseBill({
    tenant,
    userId,
    ipAddress,
    payload: {
      supplierId: String(supplierId),
      supplierInvoiceNumber: payload.supplierInvoiceNumber,
      billDate: payload.billDate,
      dueDate: payload.dueDate,
      paymentTerms: payload.paymentTerms,
      taxMode: payload.taxMode,
      updateStock: payload.updateStock,
      notes: payload.notes || null,
      action: "SAVE_AND_POST",
      items: payload.items.map((item, index) => ({
        productId: productIds[index],
        quantity: item.quantity,
        unitRate: item.unitRate,
        discountPercent: item.discountPercent,
        gstRate: payload.taxMode === "NONE" ? 0 : item.gstRate,
        taxCreditEligible: payload.taxMode !== "NONE" && item.gstRate > 0 && item.taxCreditEligible,
      })),
    },
  });

  return { bill, created, warnings };
};

module.exports = { scanBill, confirmScan };