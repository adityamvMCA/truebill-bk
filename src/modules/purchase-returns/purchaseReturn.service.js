const mongoose = require("mongoose");
const crypto = require("crypto");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const {
  postJournal,
  paiseToRupees,
} = require("../accounting/journals/journal.service");

const {
  createStockMovement,
} = require("../stock-movements/stockMovement.service");

const {
  derivePurchaseBillBalances,
  assertPurchaseBillBalances,
} = require("../../utils/purchaseBillBalances");

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

const ALLOCATED_FIELDS = [
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
];

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${label} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(String(value));
};

const safe = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError("Amount exceeds the supported range", 409);
  }

  return value;
};

const quantityMilli = (value) => {
  const scaled = value * 1000;
  const rounded = Math.round(scaled);

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isSafeInteger(rounded) ||
    Math.abs(scaled - rounded) > 0.000001
  ) {
    throw createError("Invalid return quantity");
  }

  return rounded;
};

const proportion = (amount, quantity, totalQuantity) => {
  safe(amount);

  const numerator = BigInt(amount) * BigInt(quantity);
  const denominator = BigInt(totalQuantity);

  return safe(Number((numerator + denominator / 2n) / denominator));
};

const resolveContext = (args) => {
  const connection = getReadyTenantConnection(args.tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "PurchaseReturn",
    "PurchaseBill",
    "Supplier",
    "Ledger",
    "Product",
    "StockMovement",
    "AuditLog",
  ]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  return {
    ...args,
    connection,
    models,
    tenantId: objectId(args.tenant._id, "tenantId"),
  };
};

const normalizeRequest = (payload) => {
  const requestId = String(payload.requestId ?? "")
    .trim()
    .toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      requestId,
    )
  ) {
    throw createError("requestId must be a UUID v4");
  }

  const returnDate = new Date(payload.returnDate);

  if (!payload.returnDate || Number.isNaN(returnDate.getTime())) {
    throw createError("A valid return date is required");
  }

  const reason = String(payload.reason ?? "").trim();

  if (!reason || reason.length > 1000) {
    throw createError("A return reason of at most 1000 characters is required");
  }

  if (!Number.isSafeInteger(payload.billVersion) || payload.billVersion < 0) {
    throw createError("A valid billVersion is required");
  }

  if (
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 200
  ) {
    throw createError("Provide between 1 and 200 return items");
  }

  const seen = new Set();

  const items = payload.items
    .map((item) => {
      const productId = String(objectId(item.productId, "productId"));

      if (seen.has(productId)) {
        throw createError("A product cannot appear twice");
      }

      seen.add(productId);

      return {
        productId,
        quantity: quantityMilli(item.quantity) / 1000,
      };
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));

  const normalized = {
    purchaseBillId: String(objectId(payload.purchaseBillId, "purchaseBillId")),
    billVersion: payload.billVersion,
    returnDate: returnDate.toISOString(),
    reason,
    items,
  };

  return {
    ...normalized,
    requestId,

    requestHash: crypto
      .createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex"),
  };
};

const publicReturn = (document) => {
  const result = document.toObject ? document.toObject() : { ...document };

  delete result.requestHash;

  return result;
};

const existingReturn = async (context, request, session = null) => {
  const query = context.models.PurchaseReturn.findOne({
    tenantId: context.tenantId,
    requestId: request.requestId,
  })
    .select("+requestHash")
    .lean();

  if (session) query.session(session);

  const document = await query;

  if (!document) return null;

  if (document.requestHash !== request.requestHash) {
    throw createError(
      "This requestId was already used for a different return",
      409,
    );
  }

  return publicReturn(document);
};

const audit = async (context, module, document, action, oldData = null) => {
  const newData = document.toObject();
  delete newData.requestHash;

  await context.models.AuditLog.create(
    [
      {
        tenantId: context.tenantId,
        userId: context.userId,
        module,
        action,
        documentId: document._id,
        oldData,
        newData,
        ipAddress: context.ipAddress,
      },
    ],
    { session: context.session },
  );
};

const buildReturnItems = async (context, bill, request) => {
  const sourceMap = new Map(
    bill.items.map((item) => [String(item.productId), item]),
  );

  if (sourceMap.size !== bill.items.length) {
    throw createError("Source bill contains duplicate products", 409);
  }

  const [history] = await context.models.PurchaseReturn.aggregate([
    {
      $match: {
        tenantId: context.tenantId,
        purchaseBillId: bill._id,
        status: "POSTED",
      },
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              returnedAmountPaise: { $sum: "$totalAmountPaise" },
            },
          },
        ],

        quantities: [
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.productId",

              quantityMilli: {
                $sum: {
                  $round: [{ $multiply: ["$items.quantity", 1000] }, 0],
                },
              },
            },
          },
        ],
      },
    },
  ]).session(context.session);

  const historyTotal = history?.totals?.[0]?.returnedAmountPaise || 0;

  if (historyTotal !== (bill.returnedAmountPaise ?? 0)) {
    throw createError(
      "Bill return balance does not match posted return history",
      409,
    );
  }

  const previousQuantities = new Map(
    (history?.quantities || []).map((record) => [
      String(record._id),
      safe(record.quantityMilli),
    ]),
  );

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  const stockWasReceived =
    bill.updateStock === true || Boolean(bill.sourceGoodsReceiptId);

  const items = request.items.map((input) => {
    const source = sourceMap.get(input.productId);

    if (!source) {
      throw createError("Return product does not belong to this bill");
    }

    const originalQuantity = quantityMilli(source.quantity);
    const previousQuantity = previousQuantities.get(input.productId) || 0;

    const returnQuantity = quantityMilli(input.quantity);
    const cumulativeQuantity = safe(previousQuantity + returnQuantity);

    if (cumulativeQuantity > originalQuantity) {
      throw createError(
        `Return quantity exceeds the remaining quantity for ${source.productName}`,
        409,
      );
    }

    // Allocate original stored amounts cumulatively.
    // Returning the final quantity consumes the exact
    // remaining original paise, avoiding repeated rounding drift.
    const amounts = {};

    for (const field of ALLOCATED_FIELDS) {
      amounts[field] =
        proportion(source[field], cumulativeQuantity, originalQuantity) -
        proportion(source[field], previousQuantity, originalQuantity);

      safe(amounts[field]);
    }

    amounts.grossAmountPaise = safe(
      amounts.taxableAmountPaise + amounts.discountAmountPaise,
    );

    amounts.totalAmountPaise = safe(
      amounts.taxableAmountPaise +
        amounts.cgstAmountPaise +
        amounts.sgstAmountPaise +
        amounts.igstAmountPaise,
    );

    const item = {
      productId: source.productId,
      productCode: source.productCode,
      productName: source.productName,
      productType: source.productType,
      trackInventory: source.trackInventory,
      unit: source.unit,
      hsnSacCode: source.hsnSacCode,

      quantity: input.quantity,

      unitRatePaise: source.unitRatePaise,
      discountPercent: source.discountPercent,
      gstRate: source.gstRate,
      taxCreditEligible: source.taxCreditEligible,
      purchaseLedgerId: source.purchaseLedgerId,

      stockReturned:
        stockWasReceived &&
        source.productType === "GOODS" &&
        source.trackInventory,

      ...amounts,
    };

    for (const field of AMOUNT_FIELDS) {
      totals[field] = safe(totals[field] + item[field]);
    }

    return item;
  });

  if (totals.totalAmountPaise <= 0) {
    throw createError(
      "This return rounds to zero value. Increase the return quantity.",
    );
  }

  return { items, totals };
};

const buildJournalLines = async (context, bill, data) => {
  const credits = new Map();

  const taxes = {
    INPUT_CGST: 0,
    INPUT_SGST: 0,
    INPUT_IGST: 0,
  };

  for (const item of data.items) {
    const tax = safe(
      item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise,
    );

    const expenseCredit = item.taxCreditEligible
      ? item.taxableAmountPaise
      : safe(item.taxableAmountPaise + tax);

    const key = String(item.purchaseLedgerId);

    credits.set(key, safe((credits.get(key) || 0) + expenseCredit));

    if (item.taxCreditEligible) {
      taxes.INPUT_CGST = safe(taxes.INPUT_CGST + item.cgstAmountPaise);
      taxes.INPUT_SGST = safe(taxes.INPUT_SGST + item.sgstAmountPaise);
      taxes.INPUT_IGST = safe(taxes.INPUT_IGST + item.igstAmountPaise);
    }
  }

  const lines = [
    {
      ledgerId: bill.supplierLedgerId,
      debitPaise: data.totals.totalAmountPaise,
      creditPaise: 0,
    },
  ];

  for (const [ledgerId, amount] of credits) {
    if (!amount) continue;

    lines.push({
      ledgerId,
      debitPaise: 0,
      creditPaise: amount,
    });
  }

  for (const [code, amount] of Object.entries(taxes)) {
    if (!amount) continue;

    const ledger = await context.models.Ledger.findOne({
      tenantId: context.tenantId,
      code,
      type: "TAX",
      nature: "ASSET",
      isActive: true,
    })
      .session(context.session)
      .lean();

    if (!ledger) {
      throw createError(`Active ${code} ledger is missing`, 409);
    }

    lines.push({
      ledgerId: ledger._id,
      debitPaise: 0,
      creditPaise: amount,
    });
  }

  return lines;
};

const createReturn = async (args) => {
  const context = resolveContext(args);
  context.userId = objectId(args.userId, "userId");

  const request = normalizeRequest(args.payload || {});

  const replay = await existingReturn(context, request);

  if (replay) {
    return { replayed: true, purchaseReturn: replay };
  }

  const session = await context.connection.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const tx = { ...context, session };

      const existing = await existingReturn(tx, request, session);

      if (existing) {
        result = { replayed: true, purchaseReturn: existing };
        return;
      }

      const bill = await tx.models.PurchaseBill.findOne({
        _id: request.purchaseBillId,
        tenantId: tx.tenantId,
        status: "POSTED",
        isDeleted: false,
      }).session(session);

      if (!bill) {
        throw createError("Posted Purchase Bill not found", 404);
      }

      if (bill.__v !== request.billVersion) {
        throw createError("Bill changed. Reload before returning.", 409);
      }

      assertPurchaseBillBalances(bill);

      if (new Date(request.returnDate) < bill.billDate) {
        throw createError("Return date cannot precede bill date");
      }

      const supplier = await tx.models.Supplier.findOne({
        _id: bill.supplierId,
        tenantId: tx.tenantId,
        status: "Active",
        isDeleted: false,
      }).session(session);

      if (
        !supplier ||
        String(supplier.ledgerId) !== String(bill.supplierLedgerId)
      ) {
        throw createError("Supplier or linked supplier ledger changed", 409);
      }

      const supplierLedger = await tx.models.Ledger.findOne({
        _id: bill.supplierLedgerId,
        tenantId: tx.tenantId,
        type: "SUPPLIER",
        nature: "LIABILITY",
        referenceType: "SUPPLIER",
        referenceId: supplier._id,
        isActive: true,
      })
        .session(session)
        .lean();

      if (!supplierLedger) {
        throw createError("Active linked supplier ledger not found", 409);
      }

      const data = await buildReturnItems(tx, bill, request);

      const returnedAmountPaise = safe(
        (bill.returnedAmountPaise ?? 0) + data.totals.totalAmountPaise,
      );

      const balances = derivePurchaseBillBalances({
        totalAmountPaise: bill.totalAmountPaise,
        paidAmountPaise: bill.paidAmountPaise,
        returnedAmountPaise,
      });

      const returnNumber = await getNextSequence(
        "PRET",
        String(tx.tenantId),
        3,
        {
          connection: tx.connection,
          session,
        },
      );

      const [document] = await tx.models.PurchaseReturn.create(
        [
          {
            tenantId: tx.tenantId,
            returnNumber,
            requestId: request.requestId,
            requestHash: request.requestHash,

            purchaseBillId: bill._id,
            billNumber: bill.billNumber,

            supplierId: bill.supplierId,
            supplierCode: bill.supplierCode,
            supplierName: bill.supplierName,
            supplierLedgerId: bill.supplierLedgerId,

            returnDate: request.returnDate,
            reason: request.reason,

            currency: bill.currency,
            taxMode: bill.taxMode,
            items: data.items,
            ...data.totals,

            status: "CREATED",
            stockMovementIds: [],
            createdBy: tx.userId,
          },
        ],
        { session },
      );

      const lines = await buildJournalLines(tx, bill, data);

      const journal = await postJournal({
        tenant: tx.tenant,
        connection: tx.connection,
        userId: tx.userId,
        postingDate: request.returnDate,
        sourceType: "PURCHASE_RETURN",
        sourceId: document._id,
        sourceNumber: document.returnNumber,
        narration: `Purchase return ${document.returnNumber} against ${bill.billNumber}`,
        lines,
        session,
      });

      for (const item of document.items) {
        if (!item.stockReturned) continue;

        const product = await tx.models.Product.findOne({
          _id: item.productId,
          tenantId: tx.tenantId,
          isDeleted: false,
        })
          .session(session)
          .lean();

        if (
          !product ||
          product.type !== "GOODS" ||
          !product.trackInventory ||
          product.unit !== item.unit
        ) {
          throw createError(
            `Inventory settings changed for ${item.productName}`,
            409,
          );
        }

        const stockValuePaise = item.taxCreditEligible
          ? item.taxableAmountPaise
          : item.totalAmountPaise;

        const ratePaise = proportion(
          stockValuePaise,
          1000,
          quantityMilli(item.quantity),
        );

        const movement = await createStockMovement({
          tenant: tx.tenant,
          connection: tx.connection,
          userId: tx.userId,
          productId: item.productId,
          movementType: "PURCHASE_RETURN",
          quantity: item.quantity,
          unitRate: paiseToRupees(ratePaise),
          referenceType: "PURCHASE_RETURN",
          referenceId: document._id,
          referenceNumber: document.returnNumber,
          movementDate: request.returnDate,
          notes: `Purchase return ${document.returnNumber}`,
          session,
        });

        document.stockMovementIds.push(movement.movement._id);
      }

      const oldBillData = bill.toObject();

      bill.returnedAmountPaise = returnedAmountPaise;
      bill.outstandingAmountPaise = balances.outstandingAmountPaise;
      bill.supplierCreditAmountPaise = balances.supplierCreditAmountPaise;
      bill.paymentStatus = balances.paymentStatus;
      bill.updatedBy = tx.userId;

      await bill.save({ session });

      const updatedLedger = await tx.models.Ledger.findOne({
        _id: bill.supplierLedgerId,
        tenantId: tx.tenantId,
      })
        .session(session)
        .lean();

      const oldSupplierData = supplier.toObject();

      supplier.payableBalance =
        updatedLedger.currentBalanceType === "CREDIT"
          ? updatedLedger.currentBalance
          : 0;

      await supplier.save({ session });

      document.status = "POSTED";
      document.journalId = journal._id;
      document.postedAt = new Date();
      document.postedBy = tx.userId;

      await document.save({ session });

      await audit(tx, "PURCHASE_RETURN", document, "CREATE");
      await audit(tx, "PURCHASE_BILL", bill, "UPDATE", oldBillData);
      await audit(tx, "SUPPLIER", supplier, "UPDATE", oldSupplierData);

      result = {
        replayed: false,
        purchaseReturn: publicReturn(document),
      };
    });

    return result;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await existingReturn(context, request);

      if (existing) {
        return { replayed: true, purchaseReturn: existing };
      }

      throw createError("Duplicate return number or request ID", 409);
    }

    if (error.name === "VersionError") {
      throw createError("Bill changed. Reload before continuing.", 409);
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const listReturns = async (args) => {
  const { models, tenantId } = resolveContext(args);
  const { page = 1, limit = 20 } = args;

  const filter = { tenantId, status: "POSTED" };

  for (const field of ["purchaseBillId", "supplierId"]) {
    if (args[field]) filter[field] = objectId(args[field], field);
  }

  const [data, total] = await Promise.all([
    models.PurchaseReturn.find(filter)
      .sort({ returnDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    models.PurchaseReturn.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getReturn = async (args) => {
  const { models, tenantId } = resolveContext(args);

  const document = await models.PurchaseReturn.findOne({
    tenantId,
    returnNumber: String(args.returnNumber).trim().toUpperCase(),
    status: "POSTED",
  }).lean();

  if (!document) {
    throw createError("Purchase Return not found", 404);
  }

  return document;
};

module.exports = {
  createReturn,
  listReturns,
  getReturn,
};
