const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  postJournal,
  rupeesToPaise,
  paiseToRupees,
} = require("../accounting/journals/journal.service");

const stockMovementService = require("../stock-movements/stockMovement.service");

const tdsService = require("../accounting/tds/tds.service");

const NotificationService = require("../../services/notificationService");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);

  error.statusCode = statusCode;

  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }
};

const assertSafeAmount = (value, fieldName = "Amount") => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${fieldName} exceeds the supported range`);
  }

  return value;
};

const addAmounts = (first, second) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  return first + second;
};

const multiplyDivide = (first, second, divisor) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw createError("Invalid calculation divisor");
  }

  const numerator = BigInt(first) * BigInt(second);

  const denominator = BigInt(divisor);

  const rounded = (numerator + denominator / 2n) / denominator;

  return assertSafeAmount(Number(rounded));
};

const scaledNumber = ({ value, scale, minimum, maximum, fieldName }) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError(`${fieldName} must be a valid number`);
  }

  if (value < minimum || value > maximum) {
    throw createError(`${fieldName} must be between ${minimum} and ${maximum}`);
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
    throw createError(`${fieldName} has too many decimal places`);
  }

  return integer;
};

const getPurchaseLedger = async ({ Ledger, tenantId, ledgerId, session }) => {
  const filter = {
    tenantId,
    isActive: true,
    nature: "EXPENSE",
    type: {
      $in: ["ACCOUNT", "SYSTEM"],
    },
  };

  if (ledgerId) {
    filter._id = ledgerId;
  } else {
    filter.code = "PURCHASE";
  }

  const ledger = await Ledger.findOne(filter).session(session).lean();

  if (!ledger) {
    throw createError(
      ledgerId
        ? "The product purchase ledger is missing, inactive, or not an expense ledger"
        : "The active PURCHASE expense ledger is missing. Seed accounting ledgers first.",
      409,
    );
  }

  return ledger;
};

const getSupplier = async ({
  Supplier,
  Ledger,
  tenantId,
  supplierId,
  session,
}) => {
  validateObjectId(supplierId, "supplierId");

  const supplier = await Supplier.findOne({
    _id: supplierId,
    tenantId,
    isDeleted: false,
    status: "Active",
  }).session(session);

  if (!supplier) {
    throw createError("Active supplier not found", 404);
  }

  if (!supplier.ledgerId) {
    throw createError("Supplier does not have a linked ledger", 409);
  }

  const ledger = await Ledger.findOne({
    _id: supplier.ledgerId,
    tenantId,
    type: "SUPPLIER",
    nature: "LIABILITY",
    referenceType: "SUPPLIER",
    referenceId: supplier._id,
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError("The linked supplier ledger is missing or inactive", 409);
  }

  return supplier;
};

const ensureNoDuplicateInvoice = async ({
  PurchaseBill,
  tenantId,
  billData,
  excludeId,
  session,
}) => {
  const filter = {
    tenantId,
    supplierId: billData.supplierId,
    supplierInvoiceNumberNormalized: billData.supplierInvoiceNumberNormalized,
    isDeleted: false,
  };

  if (excludeId) {
    filter._id = {
      $ne: excludeId,
    };
  }

  const existing = await PurchaseBill.findOne(filter)
    .session(session)
    .select("_id")
    .lean();

  if (existing) {
    throw createError(
      "This supplier invoice number already exists for the supplier",
      409,
    );
  }
};

const getDraftForUpdate = async ({
  PurchaseBill,
  tenantId,
  billNumber,
  session,
}) => {
  const bill = await PurchaseBill.findOne({
    tenantId,
    billNumber: normalizeCode(billNumber),
    isDeleted: false,
  }).session(session);

  if (!bill) {
    throw createError("Purchase bill not found", 404);
  }

  if (!["CREATED", "DRAFT"].includes(bill.status)) {
    throw createError(
      "Only unposted purchase bills can be edited, posted, or deleted",
      409,
    );
  }

  return bill;
};

const createAudit = async ({
  AuditLog,
  tenantId,
  userId,
  action,
  bill,
  oldData = null,
  ipAddress,
  session,
}) => {
  await AuditLog.create(
    [
      {
        tenantId,
        userId,
        action,
        module: "PURCHASE_BILL",
        documentId: bill._id,
        oldData,
        newData: bill.toObject(),
        ipAddress,
      },
    ],
    {
      session,
      ordered: true,
    },
  );
};

const getTaxLedger = async ({ Ledger, tenantId, code, session }) => {
  const ledger = await Ledger.findOne({
    tenantId,
    code,
    type: "TAX",
    nature: "ASSET",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(
      `Active ${code} tax ledger is missing. Seed accounting ledgers first.`,
      409,
    );
  }

  return ledger;
};

const buildJournalLines = async ({ models, tenantId, bill, session }) => {
  const { Ledger } = models;

  const expenseAmounts = new Map();

  const recoverableTaxes = {
    INPUT_CGST: 0,
    INPUT_SGST: 0,
    INPUT_IGST: 0,
  };

  for (const item of bill.items) {
    const taxAmount =
      item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise;

    const expenseAmount = item.taxCreditEligible
      ? item.taxableAmountPaise
      : addAmounts(item.taxableAmountPaise, taxAmount);

    const ledgerId = String(item.purchaseLedgerId);

    expenseAmounts.set(
      ledgerId,
      addAmounts(expenseAmounts.get(ledgerId) || 0, expenseAmount),
    );

    if (item.taxCreditEligible) {
      recoverableTaxes.INPUT_CGST = addAmounts(
        recoverableTaxes.INPUT_CGST,
        item.cgstAmountPaise,
      );

      recoverableTaxes.INPUT_SGST = addAmounts(
        recoverableTaxes.INPUT_SGST,
        item.sgstAmountPaise,
      );

      recoverableTaxes.INPUT_IGST = addAmounts(
        recoverableTaxes.INPUT_IGST,
        item.igstAmountPaise,
      );
    }
  }

  const lines = [];

  for (const [ledgerId, amount] of expenseAmounts) {
    if (!amount) {
      continue;
    }

    await getPurchaseLedger({
      Ledger,
      tenantId,
      ledgerId,
      session,
    });

    lines.push({
      ledgerId,
      debitPaise: amount,
      creditPaise: 0,
    });
  }

  for (const [code, amount] of Object.entries(recoverableTaxes)) {
    if (!amount) {
      continue;
    }

    const ledger = await getTaxLedger({
      Ledger,
      tenantId,
      code,
      session,
    });

    lines.push({
      ledgerId: ledger._id,
      debitPaise: amount,
      creditPaise: 0,
    });
  }

  const tdsAmountPaise = bill.tdsAmountPaise || 0;

  lines.push({
    ledgerId: bill.supplierLedgerId,
    debitPaise: 0,
    creditPaise: bill.totalAmountPaise - tdsAmountPaise,
  });

  if (tdsAmountPaise > 0) {
    lines.push({
      ledgerId: bill.tds.tdsLedgerId,
      debitPaise: 0,
      creditPaise: tdsAmountPaise,
    });
  }

  return lines;
};

const notifyBillPosted = async ({ tenantId, userId, bill }) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,
      type: "PURCHASE_BILL",
      title: "Purchase bill posted",
      message: `${bill.billNumber} for ${bill.supplierName} was posted successfully.`,
      icon: "purchase-order",
      priority: "NORMAL",
      route: "purchaseinvoices",
      data: {
        purchaseBillId: bill._id.toString(),
        billNumber: bill.billNumber,
        supplierId: bill.supplierId.toString(),
        totalAmountPaise: bill.totalAmountPaise,
      },
    });
  } catch (error) {
    console.error(
      "Purchase bill notification failed:",
      error?.message || error,
    );
  }
};

const translateDuplicateError = (error) => {
  if (error?.code === 11000) {
    return createError(
      "Purchase bill number or supplier invoice number already exists",
      409,
    );
  }

  return error;
};

const validateReceiptForBill = async ({
  models,
  tenantId,
  payload,
  supplierId,
  billItems,
  session,
}) => {
  const sourceGoodsReceiptId = payload.sourceGoodsReceiptId;

  if (sourceGoodsReceiptId === undefined || sourceGoodsReceiptId === null) {
    return null;
  }

  validateObjectId(sourceGoodsReceiptId, "sourceGoodsReceiptId");

  if (payload.updateStock === true) {
    throw createError(
      "Receipt-linked bills cannot update stock. The Goods Receipt already handled stock.",
      409,
    );
  }

  if (!models.GoodsReceipt) {
    throw createError(
      "GoodsReceipt is not registered on the tenant connection",
      500,
    );
  }

  if (
    models.PurchaseBill &&
    models.GoodsReceipt.db !== models.PurchaseBill.db
  ) {
    throw createError(
      "GoodsReceipt and PurchaseBill must use the same tenant connection",
      500,
    );
  }

  const receipt = await models.GoodsReceipt.findOne({
    _id: sourceGoodsReceiptId,
    tenantId,
    supplierId,
    status: "CREATED",
  })
    .session(session)
    .lean();

  if (!receipt) {
    throw createError("Goods Receipt not found for the selected supplier", 404);
  }

  if (!Array.isArray(receipt.items) || receipt.items.length === 0) {
    throw createError("The selected Goods Receipt has no items", 409);
  }

  if (!Array.isArray(billItems) || billItems.length === 0) {
    throw createError("Bill items are required for receipt validation");
  }

  const toQuantityMilli = (quantity, label) => {
    const scaled = quantity * 1000;
    const rounded = Math.round(scaled);

    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isSafeInteger(rounded) ||
      Math.abs(scaled - rounded) > 0.000001
    ) {
      throw createError(`${label} contains an invalid quantity`, 409);
    }

    return rounded;
  };

  const received = new Map();

  for (const item of receipt.items) {
    const key = String(item.productId);

    const quantityMilli = toQuantityMilli(item.quantity, "Goods Receipt");

    const entry = received.get(key) || {
      quantityMilli: 0,
      unit: item.unit,
      productType: item.productType,
      trackInventory: item.trackInventory,
    };

    if (
      entry.unit !== item.unit ||
      entry.productType !== item.productType ||
      entry.trackInventory !== item.trackInventory
    ) {
      throw createError("Receipt product settings are inconsistent", 409);
    }

    const nextQuantityMilli = entry.quantityMilli + quantityMilli;

    if (!Number.isSafeInteger(nextQuantityMilli)) {
      throw createError("Receipt quantity exceeds the supported range", 409);
    }

    entry.quantityMilli = nextQuantityMilli;

    received.set(key, entry);
  }

  if (received.size !== billItems.length) {
    throw createError(
      "This version requires billing the complete receipt",
      409,
    );
  }

  const seenBillProducts = new Set();

  for (const item of billItems) {
    const key = String(item.productId);

    if (seenBillProducts.has(key)) {
      throw createError("A product can appear only once in a purchase bill");
    }

    seenBillProducts.add(key);

    const entry = received.get(key);

    const billQuantityMilli = toQuantityMilli(item.quantity, "Purchase Bill");

    if (
      !entry ||
      entry.quantityMilli !== billQuantityMilli ||
      entry.unit !== item.unit ||
      entry.productType !== item.productType ||
      entry.trackInventory !== item.trackInventory
    ) {
      throw createError(
        `Bill product, quantity, or inventory settings do not match the receipt for ${item.productName || key}`,
        409,
      );
    }
  }

  return receipt._id;
};

const calculateBill = async ({ models, tenantId, payload, session }) => {
  const { Supplier, Product, Ledger } = models;

  const supplier = await getSupplier({
    Supplier,
    Ledger,
    tenantId,
    supplierId: payload.supplierId,
    session,
  });

  const supplierInvoiceNumber = normalizeText(payload.supplierInvoiceNumber);

  if (!supplierInvoiceNumber || supplierInvoiceNumber.length > 100) {
    throw createError("A valid supplier invoice number is required");
  }

  const billDate = new Date(payload.billDate);
  const dueDate = new Date(payload.dueDate);

  if (
    !payload.billDate ||
    !payload.dueDate ||
    Number.isNaN(billDate.getTime()) ||
    Number.isNaN(dueDate.getTime())
  ) {
    throw createError("Valid billDate and dueDate are required");
  }

  if (dueDate < billDate) {
    throw createError("Due date cannot be before bill date");
  }

  const taxMode = String(payload.taxMode ?? "")
    .trim()
    .toUpperCase()
    .replace(/_/g, "");

  if (!["NONE", "INTRASTATE", "INTERSTATE"].includes(taxMode)) {
    throw createError("Invalid taxMode");
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("A bill requires between 1 and 200 items");
  }

  if (
    payload.updateStock !== undefined &&
    typeof payload.updateStock !== "boolean"
  ) {
    throw createError("updateStock must be a boolean");
  }

  const updateStock = payload.updateStock ?? false;

  const productIds = payload.items.map((item) => {
    validateObjectId(item.productId, "productId");

    return String(item.productId).toLowerCase();
  });

  if (new Set(productIds).size !== productIds.length) {
    throw createError("A product can appear only once in a bill");
  }

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more products are missing, inactive, or belong to another tenant",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const purchaseLedgerCache = new Map();

  const totals = {
    grossAmountPaise: 0,
    discountAmountPaise: 0,
    taxableAmountPaise: 0,
    cgstAmountPaise: 0,
    sgstAmountPaise: 0,
    igstAmountPaise: 0,
    totalAmountPaise: 0,
  };

  const items = [];

  for (const input of payload.items) {
    const product = productMap.get(String(input.productId).toLowerCase());

    const quantityMilli = scaledNumber({
      value: input.quantity,
      scale: 1000,
      minimum: 0.001,
      maximum: 1000000,
      fieldName: `Quantity for ${product.name}`,
    });

    const discountBasisPoints = scaledNumber({
      value: input.discountPercent ?? 0,
      scale: 100,
      minimum: 0,
      maximum: 100,
      fieldName: `Discount for ${product.name}`,
    });

    if (
      typeof input.unitRate !== "number" ||
      !Number.isFinite(input.unitRate) ||
      input.unitRate < 0 ||
      input.unitRate > 1000000000
    ) {
      throw createError(`Invalid unit rate for ${product.name}`);
    }

    const unitRatePaise = rupeesToPaise(input.unitRate, "Unit rate");

    const gstRate = input.gstRate ?? product.gstRate;

    if (![0, 3, 5, 12, 18, 28].includes(gstRate)) {
      throw createError(`Invalid GST rate for ${product.name}`);
    }

    if (taxMode === "NONE" && gstRate !== 0) {
      throw createError(
        `GST rate must be zero for ${product.name} when taxMode is NONE`,
      );
    }

    const taxCreditEligible = input.taxCreditEligible ?? false;

    if (typeof taxCreditEligible !== "boolean") {
      throw createError("taxCreditEligible must be a boolean");
    }

    if (taxCreditEligible && !supplier.gstNo) {
      throw createError(
        "Supplier GST number is required when claiming input tax credit",
      );
    }

    const cacheKey = product.purchaseLedgerId
      ? String(product.purchaseLedgerId)
      : "DEFAULT_PURCHASE";

    if (!purchaseLedgerCache.has(cacheKey)) {
      const ledger = await getPurchaseLedger({
        Ledger,
        tenantId,
        ledgerId: product.purchaseLedgerId,
        session,
      });

      purchaseLedgerCache.set(cacheKey, ledger);
    }

    const purchaseLedger = purchaseLedgerCache.get(cacheKey);

    const grossAmountPaise = multiplyDivide(unitRatePaise, quantityMilli, 1000);

    const discountAmountPaise = multiplyDivide(
      grossAmountPaise,
      discountBasisPoints,
      10000,
    );

    const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

    const taxAmountPaise = multiplyDivide(taxableAmountPaise, gstRate, 100);

    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    if (taxMode === "INTRASTATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);

      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (taxMode === "INTERSTATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const totalAmountPaise = assertSafeAmount(
      addAmounts(taxableAmountPaise, taxAmountPaise),
    );

    const item = {
      productId: product._id,
      productCode: product.productCode,
      productName: product.name,
      productType: product.type,

      trackInventory:
        product.type === "GOODS" ? Boolean(product.trackInventory) : false,

      unit: product.unit,
      hsnSacCode: product.hsnSacCode || null,

      quantity: quantityMilli / 1000,
      unitRatePaise,
      discountPercent: discountBasisPoints / 100,

      gstRate,
      taxCreditEligible,
      purchaseLedgerId: purchaseLedger._id,

      grossAmountPaise,
      discountAmountPaise,
      taxableAmountPaise,
      cgstAmountPaise,
      sgstAmountPaise,
      igstAmountPaise,
      totalAmountPaise,
    };

    items.push(item);

    for (const field of Object.keys(totals)) {
      totals[field] = assertSafeAmount(addAmounts(totals[field], item[field]));
    }
  }

  let tds = null;

  if (payload.tds) {
    tds = await tdsService.computeBookingTds({
      models,
      tenantId,
      input: payload.tds,
      partyLedgerId: supplier.ledgerId,
      basePaise: totals.taxableAmountPaise,
      date: billDate,
      session,
    });

    if (tds.tdsPaise >= totals.totalAmountPaise) {
      throw createError("TDS cannot be equal to or more than the bill total");
    }
  }

  const tdsAmountPaise = tds?.tdsPaise || 0;

  const sourceGoodsReceiptId = await validateReceiptForBill({
    models,
    tenantId,

    payload: {
      sourceGoodsReceiptId: payload.sourceGoodsReceiptId,

      updateStock,
    },

    supplierId: supplier._id,
    billItems: items,
    session,
  });

  return {
    sourceGoodsReceiptId,

    supplierId: supplier._id,
    supplierCode: supplier.supplierCode,
    supplierName: supplier.supplierName,
    supplierLedgerId: supplier.ledgerId,
    supplierGstNo: supplier.gstNo || null,

    supplierInvoiceNumber,

    supplierInvoiceNumberNormalized: supplierInvoiceNumber.toUpperCase(),

    billDate,
    dueDate,
    currency: "INR",

    paymentTerms:
      normalizeText(payload.paymentTerms) ||
      supplier.paymentTerms ||
      "Due on Receipt",

    taxMode,
    updateStock,

    items,
    ...totals,

    paidAmountPaise: 0,

    tdsAmountPaise,
    tds: tds
      ? {
          natureId: tds.natureId,
          section: tds.section,
          deducteeType: tds.deducteeType,
          pan: tds.pan,
          ratePercent: tds.ratePercent,
          taxableBasePaise: tds.taxableBasePaise,
          reason: tds.reason,
          certificateNumber: tds.certificateNumber,
          tdsLedgerId: tds.tdsLedgerId,
        }
      : null,

    outstandingAmountPaise: totals.totalAmountPaise - tdsAmountPaise,

    paymentStatus: "UNPAID",

    notes: normalizeText(payload.notes) || null,
  };
};

const postBillInTransaction = async ({
  models,
  tenant,
  tenantId,
  userId,
  bill,
  ipAddress,
  session,
}) => {
  const { Supplier, Product, Ledger } = models;

  if (!session || !session.inTransaction()) {
    throw createError(
      "Purchase bill posting requires an active transaction",
      500,
    );
  }

  if (!["CREATED", "DRAFT"].includes(bill.status) || bill.isDeleted) {
    throw createError(
      "Only an active unposted purchase bill can be posted",
      409,
    );
  }

  if (
    !Number.isSafeInteger(bill.totalAmountPaise) ||
    bill.totalAmountPaise <= 0
  ) {
    throw createError(
      "A bill must have a positive safe-integer total to be posted",
    );
  }

  const connection = models.connection || models.PurchaseBill?.db;

  if (
    !connection ||
    models.PurchaseBill?.db !== connection ||
    Ledger.db !== connection ||
    Product.db !== connection ||
    Supplier.db !== connection
  ) {
    throw createError(
      "Purchase bill models must use the same tenant connection",
      500,
    );
  }

  const oldData = bill.toObject();

  const supplier = await getSupplier({
    Supplier,
    Ledger,
    tenantId,
    supplierId: bill.supplierId,
    session,
  });

  if (String(supplier.ledgerId) !== String(bill.supplierLedgerId)) {
    throw createError(
      "Supplier ledger has changed. Update the unposted bill before posting.",
      409,
    );
  }

  const productIds = bill.items.map((item) => item.productId);

  if (new Set(productIds.map(String)).size !== productIds.length) {
    throw createError("A product can appear only once in a purchase bill");
  }

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError("One or more bill products are no longer active", 409);
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  for (const item of bill.items) {
    const product = productMap.get(String(item.productId));

    const tracksStock =
      product.type === "GOODS" ? Boolean(product.trackInventory) : false;

    if (
      product.type !== item.productType ||
      tracksStock !== item.trackInventory ||
      product.unit !== item.unit
    ) {
      throw createError(
        `Product settings changed for ${item.productName}. Update the unposted bill before posting.`,
        409,
      );
    }
  }

  await validateReceiptForBill({
    models,
    tenantId,

    payload: {
      sourceGoodsReceiptId: bill.sourceGoodsReceiptId,

      updateStock: bill.updateStock,
    },

    supplierId: bill.supplierId,
    billItems: bill.items,
    session,
  });

  if (bill.tds) {
    const recheck = await tdsService.computeBookingTds({
      models,
      tenantId,
      input: {
        natureId: bill.tds.natureId,
        deducteeType: bill.tds.deducteeType,
        pan: bill.tds.pan,
      },
      partyLedgerId: bill.supplierLedgerId,
      basePaise: bill.taxableAmountPaise,
      date: bill.billDate,
      session,
    });

    if (recheck.tdsPaise !== bill.tdsAmountPaise) {
      throw createError(
        "TDS has changed since this bill was saved. Update the bill and retry.",
        409,
      );
    }
  }

  const lines = await buildJournalLines({
    models,
    tenantId,
    bill,
    session,
  });

  const journal = await postJournal({
    tenant,
    connection,
    userId,

    postingDate: bill.billDate,

    sourceType: "PURCHASE_BILL",
    sourceId: bill._id,
    sourceNumber: bill.billNumber,

    narration: `Purchase bill ${bill.billNumber} - ${bill.supplierName}`,

    lines,
    session,
  });

  if (bill.tds) {
    await tdsService.recordDeduction({
      tenant,
      connection,
      userId,
      session,
      input: {
        date: bill.billDate,
        partyLedgerId: bill.supplierLedgerId,
        partyName: bill.supplierName,
        pan: bill.tds.pan,
        deducteeType: bill.tds.deducteeType,
        natureId: bill.tds.natureId,
        section: bill.tds.section,
        baseAmountPaise: bill.taxableAmountPaise,
        taxableBasePaise: bill.tds.taxableBasePaise,
        ratePercent: bill.tds.ratePercent,
        tdsPaise: bill.tdsAmountPaise,
        reason: bill.tds.reason,
        certificateNumber: bill.tds.certificateNumber,
        sourceType: "PURCHASE_BILL",
        sourceId: bill._id,
        sourceNumber: bill.billNumber,
        journalId: journal._id,
      },
    });
  }

  if (bill.updateStock) {
    for (const item of bill.items) {
      if (!item.trackInventory) {
        continue;
      }

      const quantityMilli = scaledNumber({
        value: item.quantity,
        scale: 1000,
        minimum: 0.001,
        maximum: 1000000,
        fieldName: `Quantity for ${item.productName}`,
      });

      const stockValuePaise = item.taxCreditEligible
        ? item.taxableAmountPaise
        : item.totalAmountPaise;

      const stockUnitRatePaise = multiplyDivide(
        stockValuePaise,
        1000,
        quantityMilli,
      );

      await stockMovementService.createStockMovement({
        tenant,
        connection,
        userId,

        productId: item.productId,
        movementType: "PURCHASE",

        quantity: item.quantity,

        unitRate: paiseToRupees(stockUnitRatePaise),

        referenceType: "PURCHASE_BILL",
        referenceId: bill._id,
        referenceNumber: bill.billNumber,

        movementDate: bill.billDate,

        notes: `Purchase bill ${bill.billNumber}`,

        session,
      });
    }
  }

  const supplierLedger = await Ledger.findOne({
    _id: bill.supplierLedgerId,
    tenantId,
  })
    .session(session)
    .lean();

  if (!supplierLedger) {
    throw createError("Supplier ledger was not found after posting", 409);
  }

  supplier.payableBalance =
    supplierLedger.currentBalanceType === "CREDIT"
      ? supplierLedger.currentBalance
      : 0;

  await supplier.save({ session });

  bill.status = "POSTED";
  bill.journalId = journal._id;
  bill.postedAt = new Date();
  bill.postedBy = userId;
  bill.updatedBy = userId;

  await bill.save({ session });

  await createAudit({
    AuditLog: models.AuditLog,
    tenantId,
    userId,
    action: "POST",
    bill,
    oldData,
    ipAddress,
    session,
  });

  return bill;
};

const createPurchaseBill = async ({ tenant, userId, payload, ipAddress }) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError("Purchase bill payload is required");
  }

  if (
    payload.action !== undefined &&
    !["SAVE_AND_POST", "SAVEANDPOST"].includes(payload.action)
  ) {
    throw createError(
      "Purchase bills are automatically posted. Saving a draft is not supported.",
    );
  }

  validateObjectId(userId, "userId");

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);
  models.connection = connection;

  const tenantId = tenant._id;
  const session = await connection.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const billData = await calculateBill({
        models,
        tenantId,
        payload,
        session,
      });

      if (billData.totalAmountPaise <= 0) {
        throw createError("A purchase bill must have a positive total");
      }

      await ensureNoDuplicateInvoice({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billData,
        session,
      });

      const billNumber = await getNextSequence("PB", tenantId.toString(), 3, {
        connection,
        session,
      });

      const [bill] = await models.PurchaseBill.create(
        [
          {
            ...billData,
            tenantId,
            billNumber,
            status: "CREATED",
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );

      await createAudit({
        AuditLog: models.AuditLog,
        tenantId,
        userId,
        action: "CREATE",
        bill,
        ipAddress,
        session,
      });

      await postBillInTransaction({
        models,
        tenant,
        tenantId,
        userId,
        bill,
        ipAddress,
        session,
      });

      result = bill.toObject();
    });
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }

  await notifyBillPosted({ tenantId, userId, bill: result });
  return result;
};

const updatePurchaseBill = async ({
  tenant,
  userId,
  billNumber,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const bill = await getDraftForUpdate({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billNumber,
        session,
      });

      const oldData = bill.toObject();

      const billData = await calculateBill({
        models,
        tenantId,
        payload,
        session,
      });

      await ensureNoDuplicateInvoice({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billData,
        excludeId: bill._id,
        session,
      });

      bill.set(billData);
      bill.updatedBy = userId;

      await bill.save({ session });

      await createAudit({
        AuditLog: models.AuditLog,
        tenantId,
        userId,
        action: "UPDATE",
        bill,
        oldData,
        ipAddress,
        session,
      });

      result = bill.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const postPurchaseBill = async ({ tenant, userId, billNumber, ipAddress }) => {
  validateObjectId(userId, "userId");

  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  models.connection = connection;

  const tenantId = tenant._id;

  const session = await connection.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const bill = await getDraftForUpdate({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billNumber,
        session,
      });

      await postBillInTransaction({
        models,
        tenant,
        tenantId,
        userId,
        bill,
        ipAddress,
        session,
      });

      result = bill.toObject();
    });
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }

  await notifyBillPosted({
    tenantId,
    userId,
    bill: result,
  });

  return result;
};

const deletePurchaseBill = async ({
  tenant,
  userId,
  billNumber,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const bill = await getDraftForUpdate({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billNumber,
        session,
      });

      const oldData = bill.toObject();

      bill.isDeleted = true;
      bill.deletedAt = new Date();
      bill.deletedBy = userId;
      bill.updatedBy = userId;

      await bill.save({ session });

      await createAudit({
        AuditLog: models.AuditLog,
        tenantId,
        userId,
        action: "DELETE",
        bill,
        oldData,
        ipAddress,
        session,
      });

      result = bill.toObject();
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPurchaseBills = async ({
  tenant,
  search = "",
  supplierId,
  status,
  paymentStatus,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (supplierId) {
    filter.supplierId = supplierId;
  }

  if (status) {
    filter.status = status;
  }

  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }

  if (fromDate || toDate) {
    filter.billDate = {};

    if (fromDate) {
      filter.billDate.$gte = new Date(fromDate);
    }

    if (toDate) {
      filter.billDate.$lte = new Date(toDate);
    }
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    filter.$or = [
      { billNumber: regex },
      { supplierName: regex },
      { supplierCode: regex },
      {
        supplierInvoiceNumber: regex,
      },
    ];
  }

  const [data, total] = await Promise.all([
    models.PurchaseBill.find(filter)
      .select("-items")
      .sort({
        billDate: -1,
        createdAt: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    models.PurchaseBill.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getPurchaseBillByNumber = async ({ tenant, billNumber }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const bill = await models.PurchaseBill.findOne({
    tenantId: tenant._id,
    billNumber: normalizeCode(billNumber),
    isDeleted: false,
  }).lean();

  if (!bill) {
    throw createError("Purchase bill not found", 404);
  }

  return bill;
};

const getPurchaseBillPayments = async ({
  tenant,
  billNumber,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const bill = await models.PurchaseBill.findOne({
    tenantId,
    billNumber: normalizeCode(billNumber),
    isDeleted: false,
  })
    .select("_id billNumber")
    .lean();

  if (!bill) {
    throw createError("Purchase bill not found", 404);
  }

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const filter = {
    tenantId,
    "allocations.purchaseBillId": bill._id,
  };

  const [payments, total] = await Promise.all([
    models.SupplierPayment.find(filter)
      .select(
        "paymentNumber paymentDate paymentMethod paymentLedgerName referenceNumber status allocations createdAt",
      )
      .sort({
        paymentDate: -1,
        createdAt: -1,
        _id: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    models.SupplierPayment.countDocuments(filter),
  ]);

  const data = payments.map((payment) => {
    const allocatedAmountPaise = payment.allocations
      .filter(
        (allocation) => String(allocation.purchaseBillId) === String(bill._id),
      )
      .reduce((sum, allocation) => sum + allocation.amountPaise, 0);

    return {
      _id: payment._id,
      paymentNumber: payment.paymentNumber,
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      paymentLedgerName: payment.paymentLedgerName,
      referenceNumber: payment.referenceNumber,
      status: payment.status,
      allocatedAmountPaise,
    };
  });

  return {
    data,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

module.exports = {
  createPurchaseBill,
  updatePurchaseBill,
  postPurchaseBill,
  deletePurchaseBill,
  getPurchaseBills,
  getPurchaseBillByNumber,
  getPurchaseBillPayments,
};