const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  postJournal,
  rupeesToPaise,
} = require("../../accounting/journals/journal.service");

const NotificationService = require("../../../services/notificationService");
const { getNextSequence } = require("../../../utils/sequenceGenerator");

/* ==========================================
   HELPERS
   ========================================== */

const GST_RATES = [0, 5, 12, 18, 28];
const METHODS = ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"];
const MAX_TOTAL_PAISE = 100000000000;

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

const getPagination = (page, limit, defaultLimit = 20) => {
  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);
  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || defaultLimit), 1),
    100,
  );
  return { currentPage, pageLimit, skip: (currentPage - 1) * pageLimit };
};

const getContext = (tenant) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of ["Expense", "Supplier", "Ledger", "Journal", "AuditLog"]) {
    if (!models[name] || models[name].db !== connection) {
      throw createError(`Invalid tenant model: ${name}`, 500);
    }
  }

  validateObjectId(tenant._id, "tenantId");

  return { connection, models, tenantId: tenant._id };
};

/* ==========================================
   NORMALIZE REQUEST
   ========================================== */

const normalizeRequest = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createError("Expense payload is required");
  }

  const requestId = normalizeText(payload.requestId).toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      requestId,
    )
  ) {
    throw createError("requestId must be a UUID v4");
  }

  const expenseDate = new Date(payload.expenseDate);

  if (!payload.expenseDate || Number.isNaN(expenseDate.getTime())) {
    throw createError("A valid expenseDate is required");
  }

  const paymentMode = normalizeCode(payload.paymentMode);

  if (!["PAID", "PAYABLE"].includes(paymentMode)) {
    throw createError("paymentMode must be PAID or PAYABLE");
  }

  let paymentMethod = null;
  let paymentLedgerId = null;
  let supplierId = null;

  if (paymentMode === "PAID") {
    paymentMethod = normalizeCode(payload.paymentMethod);

    if (!METHODS.includes(paymentMethod)) {
      throw createError("Invalid payment method");
    }

    validateObjectId(payload.paymentLedgerId, "paymentLedgerId");
    paymentLedgerId = String(payload.paymentLedgerId);
  } else {
    validateObjectId(payload.supplierId, "supplierId");
    supplierId = String(payload.supplierId);
  }

  const taxMode = normalizeCode(payload.taxMode || "NONE");

  if (!["NONE", "GST"].includes(taxMode)) {
    throw createError("taxMode must be NONE or GST");
  }

  if (
    !Array.isArray(payload.lines) ||
    payload.lines.length < 1 ||
    payload.lines.length > 100
  ) {
    throw createError("An expense requires between 1 and 100 lines");
  }

  let taxableTotalPaise = 0;
  let taxTotalPaise = 0;

  const lines = payload.lines.map((line, index) => {
    const label = `Line ${index + 1}`;

    if (!line || typeof line !== "object") {
      throw createError(`${label} is invalid`);
    }

    validateObjectId(line.expenseLedgerId, `${label} expenseLedgerId`);

    const description = normalizeText(line.description);

    if (!description || description.length > 300) {
      throw createError(`${label} needs a description (max 300 characters)`);
    }

    const amountPaise = rupeesToPaise(line.amount, `${label} amount`);

    if (amountPaise <= 0) {
      throw createError(`${label} amount must be greater than zero`);
    }

    const gstRate = taxMode === "NONE" ? 0 : Number(line.gstRate || 0);

    if (!GST_RATES.includes(gstRate)) {
      throw createError(`${label} has an invalid GST rate`);
    }

    const taxPaise = Math.round((amountPaise * gstRate) / 100);

    taxableTotalPaise += amountPaise;
    taxTotalPaise += taxPaise;

    return {
      expenseLedgerId: String(line.expenseLedgerId),
      description,
      amountPaise,
      gstRate,
      taxPaise,
      totalPaise: amountPaise + taxPaise,
    };
  });

  const totalAmountPaise = taxableTotalPaise + taxTotalPaise;

  if (
    !Number.isSafeInteger(totalAmountPaise) ||
    totalAmountPaise <= 0 ||
    totalAmountPaise > MAX_TOTAL_PAISE
  ) {
    throw createError("Expense total is outside the supported range");
  }

  let inputGstLedgerId = null;

  if (taxTotalPaise > 0) {
    validateObjectId(payload.inputGstLedgerId, "inputGstLedgerId");
    inputGstLedgerId = String(payload.inputGstLedgerId);
  }

  const referenceNumber = normalizeText(payload.referenceNumber) || null;
  const payeeName = normalizeText(payload.payeeName) || null;
  const notes = normalizeText(payload.notes) || null;

  if (referenceNumber && referenceNumber.length > 100) {
    throw createError("Reference number cannot exceed 100 characters");
  }

  if (payeeName && payeeName.length > 150) {
    throw createError("Payee name cannot exceed 150 characters");
  }

  if (notes && notes.length > 1000) {
    throw createError("Notes cannot exceed 1000 characters");
  }

  return {
    requestId,
    expenseDate,
    paymentMode,
    paymentMethod,
    paymentLedgerId,
    supplierId,
    taxMode,
    inputGstLedgerId,
    lines,
    taxableTotalPaise,
    taxTotalPaise,
    totalAmountPaise,
    referenceNumber,
    payeeName,
    notes,
  };
};

/* ==========================================
   LEDGER LOOKUPS (shared by create + approve)
   ========================================== */

const loadExpenseLedgers = async ({ models, tenantId, ids, session }) => {
  const uniqueIds = [...new Set(ids.map(String))];

  const ledgers = await models.Ledger.find({
    tenantId,
    _id: { $in: uniqueIds },
    type: "ACCOUNT",
    nature: "EXPENSE",
    isActive: true,
  }).session(session);

  if (ledgers.length !== uniqueIds.length) {
    throw createError(
      "One or more expense accounts are missing, inactive, or not expense ledgers",
      409,
    );
  }

  return new Map(ledgers.map((ledger) => [String(ledger._id), ledger]));
};

const loadPaymentLedger = async ({
  models,
  tenantId,
  ledgerId,
  method,
  session,
  amountPaise = null,
}) => {
  const ledger = await models.Ledger.findOne({
    _id: ledgerId,
    tenantId,
    type: method === "CASH" ? "CASH" : "BANK",
    nature: "ASSET",
    isActive: true,
  }).session(session);

  if (!ledger) {
    throw createError(
      method === "CASH"
        ? "Select an active CASH asset ledger"
        : "Select an active BANK asset ledger",
      409,
    );
  }

  // Balance is only enforced when the expense is approved and posted.
  if (amountPaise !== null) {
    const balancePaise = rupeesToPaise(
      ledger.currentBalance,
      `Balance of ${ledger.name}`,
    );

    if (ledger.currentBalanceType !== "DEBIT" || balancePaise < amountPaise) {
      throw createError(
        `Insufficient recorded balance in ${ledger.name}. ` +
          "Negative cash or bank balances are not supported.",
        409,
      );
    }
  }

  return ledger;
};

const loadSupplierAndLedger = async ({
  models,
  tenantId,
  supplierId,
  session,
}) => {
  const supplier = await models.Supplier.findOne({
    _id: supplierId,
    tenantId,
    status: "Active",
    isDeleted: false,
  }).session(session);

  if (!supplier) throw createError("Active supplier not found", 404);

  if (!supplier.ledgerId) {
    throw createError("Supplier has no linked accounting ledger", 409);
  }

  const ledger = await models.Ledger.findOne({
    _id: supplier.ledgerId,
    tenantId,
    type: "SUPPLIER",
    nature: "LIABILITY",
    referenceType: "SUPPLIER",
    referenceId: supplier._id,
    isActive: true,
  }).session(session);

  if (!ledger) {
    throw createError("The linked supplier ledger is missing or inactive", 409);
  }

  return { supplier, ledger };
};

const loadInputGstLedger = async ({ models, tenantId, ledgerId, session }) => {
  const ledger = await models.Ledger.findOne({
    _id: ledgerId,
    tenantId,
    type: "TAX",
    nature: "ASSET",
    isActive: true,
  }).session(session);

  if (!ledger) {
    throw createError("Select an active Input GST (tax asset) ledger", 409);
  }

  return ledger;
};

/* ==========================================
   NOTIFICATION
   ========================================== */

const notify = async ({ tenantId, userId, expense, title, message }) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,
      type: "EXPENSE",
      title,
      message,
      icon: "receipt",
      priority: "NORMAL",
      route: `/expenses/${expense.expenseNumber}`,
      data: {
        expenseId: String(expense._id),
        expenseNumber: expense.expenseNumber,
        amountPaise: expense.totalAmountPaise,
      },
    });
  } catch (error) {
    console.error("Expense notification failed:", error?.message || error);
  }
};

/* ==========================================
   OPTIONS (ledgers for the create form)
   ========================================== */

const getExpenseOptions = async ({ tenant }) => {
  const { models, tenantId } = getContext(tenant);
  const { Ledger } = models;

  const [expenseLedgers, paymentLedgers, taxLedgers] = await Promise.all([
    Ledger.find({
      tenantId,
      type: "ACCOUNT",
      nature: "EXPENSE",
      isActive: true,
    })
      .select("code name")
      .sort({ name: 1, _id: 1 })
      .lean(),

    Ledger.find({
      tenantId,
      type: { $in: ["CASH", "BANK"] },
      nature: "ASSET",
      isActive: true,
    })
      .select("code name type currentBalance currentBalanceType")
      .sort({ type: 1, name: 1, _id: 1 })
      .lean(),

    Ledger.find({ tenantId, type: "TAX", nature: "ASSET", isActive: true })
      .select("code name")
      .sort({ name: 1, _id: 1 })
      .lean(),
  ]);

  return { expenseLedgers, paymentLedgers, taxLedgers };
};

/* ==========================================
   CREATE (status NEW)
   ========================================== */

const createExpense = async ({ tenant, userId, payload, ipAddress }) => {
  const { connection, models, tenantId } = getContext(tenant);
  const { Expense, AuditLog } = models;

  validateObjectId(userId, "userId");

  const request = normalizeRequest(payload);

  const findExisting = (session) => {
    const query = Expense.findOne({
      tenantId,
      requestId: request.requestId,
    }).lean();
    if (session) query.session(session);
    return query;
  };

  const existing = await findExisting();

  if (existing) return { expense: existing, replayed: true };

  const session = await connection.startSession();

  let result;
  let createdNew = false;

  try {
    await session.withTransaction(async () => {
      createdNew = false;
      result = null;

      const already = await findExisting(session);

      if (already) {
        result = already;
        return;
      }

      const ledgerMap = await loadExpenseLedgers({
        models,
        tenantId,
        ids: request.lines.map((line) => line.expenseLedgerId),
        session,
      });

      let paymentLedger = null;
      let supplier = null;
      let supplierLedger = null;

      if (request.paymentMode === "PAID") {
        paymentLedger = await loadPaymentLedger({
          models,
          tenantId,
          ledgerId: request.paymentLedgerId,
          method: request.paymentMethod,
          session,
        });
      } else {
        ({ supplier, ledger: supplierLedger } = await loadSupplierAndLedger({
          models,
          tenantId,
          supplierId: request.supplierId,
          session,
        }));
      }

      if (request.taxTotalPaise > 0) {
        await loadInputGstLedger({
          models,
          tenantId,
          ledgerId: request.inputGstLedgerId,
          session,
        });
      }

      const expenseNumber = await getNextSequence(
        "EX",
        tenantId.toString(),
        3,
        {
          connection,
          session,
        },
      );

      const [expense] = await Expense.create(
        [
          {
            tenantId,
            expenseNumber,
            requestId: request.requestId,
            expenseDate: request.expenseDate,
            status: "NEW",

            paymentMode: request.paymentMode,
            paymentMethod: request.paymentMethod,

            paymentLedgerId: paymentLedger?._id ?? null,
            paymentLedgerCode: paymentLedger?.code ?? null,
            paymentLedgerName: paymentLedger?.name ?? null,
            paymentLedgerType: paymentLedger?.type ?? null,

            supplierId: supplier?._id ?? null,
            supplierCode: supplier?.supplierCode ?? null,
            supplierName: supplier?.supplierName ?? null,
            supplierLedgerId: supplierLedger?._id ?? null,

            payeeName: request.payeeName,
            referenceNumber: request.referenceNumber,
            currency: "INR",

            taxMode: request.taxMode,
            inputGstLedgerId: request.inputGstLedgerId,

            lines: request.lines.map((line) => {
              const ledger = ledgerMap.get(line.expenseLedgerId);

              return {
                expenseLedgerId: ledger._id,
                ledgerCode: ledger.code,
                ledgerName: ledger.name,
                description: line.description,
                amountPaise: line.amountPaise,
                gstRate: line.gstRate,
                taxPaise: line.taxPaise,
                totalPaise: line.totalPaise,
              };
            }),

            taxableTotalPaise: request.taxableTotalPaise,
            taxTotalPaise: request.taxTotalPaise,
            totalAmountPaise: request.totalAmountPaise,

            notes: request.notes,
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "CREATE",
            module: "EXPENSE",
            documentId: expense._id,
            newData: expense.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );

      result = expense.toObject();
      createdNew = true;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await findExisting();

      if (replay) return { expense: replay, replayed: true };

      throw createError(
        "A duplicate expense number or request ID was detected",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }

  return { expense: result, replayed: !createdNew };
};

/* ==========================================
   APPROVE (admin) - posts the journal
   ========================================== */

const approveExpense = async ({ tenant, userId, expenseNumber, ipAddress }) => {
  const { connection, models, tenantId } = getContext(tenant);
  const { Expense, Ledger, AuditLog } = models;

  validateObjectId(userId, "userId");

  const number = normalizeCode(expenseNumber);

  if (!number) throw createError("Expense number is required");

  const session = await connection.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      result = null;

      const expense = await Expense.findOne({
        tenantId,
        expenseNumber: number,
      }).session(session);

      if (!expense) throw createError("Expense not found", 404);

      if (expense.status !== "NEW") {
        throw createError(
          `Only NEW expenses can be approved. This expense is ${expense.status}.`,
          409,
        );
      }

      const oldData = expense.toObject();

      await loadExpenseLedgers({
        models,
        tenantId,
        ids: expense.lines.map((line) => line.expenseLedgerId),
        session,
      });

      const journalLines = expense.lines.map((line) => ({
        ledgerId: line.expenseLedgerId,
        debitPaise: line.amountPaise,
        creditPaise: 0,
        narration: line.description,
      }));

      if (expense.taxTotalPaise > 0) {
        const gstLedger = await loadInputGstLedger({
          models,
          tenantId,
          ledgerId: expense.inputGstLedgerId,
          session,
        });

        journalLines.push({
          ledgerId: gstLedger._id,
          debitPaise: expense.taxTotalPaise,
          creditPaise: 0,
        });
      }

      let supplier = null;

      if (expense.paymentMode === "PAID") {
        const paymentLedger = await loadPaymentLedger({
          models,
          tenantId,
          ledgerId: expense.paymentLedgerId,
          method: expense.paymentMethod,
          amountPaise: expense.totalAmountPaise,
          session,
        });

        journalLines.push({
          ledgerId: paymentLedger._id,
          debitPaise: 0,
          creditPaise: expense.totalAmountPaise,
        });
      } else {
        const loaded = await loadSupplierAndLedger({
          models,
          tenantId,
          supplierId: expense.supplierId,
          session,
        });

        supplier = loaded.supplier;

        journalLines.push({
          ledgerId: loaded.ledger._id,
          debitPaise: 0,
          creditPaise: expense.totalAmountPaise,
        });
      }

      const journal = await postJournal({
        tenant,
        connection,
        userId,
        postingDate: expense.expenseDate,
        sourceType: "EXPENSE",
        sourceId: expense._id,
        sourceNumber: expense.expenseNumber,
        narration:
          `Expense ${expense.expenseNumber}` +
          (expense.supplierName
            ? ` — ${expense.supplierName}`
            : expense.payeeName
              ? ` — ${expense.payeeName}`
              : ""),
        lines: journalLines,
        session,
      });

      expense.status = "APPROVED";
      expense.journalId = journal._id;
      expense.approvedBy = userId;
      expense.approvedAt = new Date();
      expense.updatedBy = userId;

      await expense.save({ session });

      if (supplier) {
        const updatedLedger = await Ledger.findOne({
          _id: supplier.ledgerId,
          tenantId,
        })
          .session(session)
          .lean();

        const oldSupplierData = supplier.toObject();

        supplier.payableBalance =
          updatedLedger?.currentBalanceType === "CREDIT"
            ? updatedLedger.currentBalance
            : 0;

        await supplier.save({ session });

        await AuditLog.create(
          [
            {
              tenantId,
              userId,
              action: "UPDATE",
              module: "SUPPLIER",
              documentId: supplier._id,
              oldData: oldSupplierData,
              newData: supplier.toObject(),
              ipAddress,
            },
          ],
          { session, ordered: true },
        );
      }

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "UPDATE",
            module: "EXPENSE",
            documentId: expense._id,
            oldData,
            newData: expense.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );

      result = expense.toObject();
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw createError("This expense has already been posted", 409);
    }

    if (error?.name === "VersionError") {
      throw createError(
        "The expense or a related ledger changed. Reload and try again.",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }

  await notify({
    tenantId,
    userId: result.createdBy,
    expense: result,
    title: "Expense approved",
    message: `${result.expenseNumber} was approved and posted.`,
  });

  return result;
};

/* ==========================================
   REJECT (admin)
   ========================================== */

const rejectExpense = async ({
  tenant,
  userId,
  expenseNumber,
  reason,
  ipAddress,
}) => {
  const { models, tenantId } = getContext(tenant);
  const { Expense, AuditLog } = models;

  validateObjectId(userId, "userId");

  const rejectionReason = normalizeText(reason);

  if (!rejectionReason) throw createError("A rejection reason is required");

  if (rejectionReason.length > 500) {
    throw createError("Rejection reason cannot exceed 500 characters");
  }

  const expense = await Expense.findOne({
    tenantId,
    expenseNumber: normalizeCode(expenseNumber),
  });

  if (!expense) throw createError("Expense not found", 404);

  if (expense.status !== "NEW") {
    throw createError(
      `Only NEW expenses can be rejected. This expense is ${expense.status}.`,
      409,
    );
  }

  const oldData = expense.toObject();

  expense.status = "REJECTED";
  expense.rejectedBy = userId;
  expense.rejectedAt = new Date();
  expense.rejectionReason = rejectionReason;
  expense.updatedBy = userId;

  try {
    await expense.save();
  } catch (error) {
    if (error?.name === "VersionError") {
      throw createError("The expense changed. Reload and try again.", 409);
    }
    throw error;
  }

  await AuditLog.create({
    tenantId,
    userId,
    action: "UPDATE",
    module: "EXPENSE",
    documentId: expense._id,
    oldData,
    newData: expense.toObject(),
    ipAddress,
  });

  await notify({
    tenantId,
    userId: expense.createdBy,
    expense,
    title: "Expense rejected",
    message: `${expense.expenseNumber} was rejected: ${rejectionReason}`,
  });

  return expense.toObject();
};

/* ==========================================
   CANCEL (creator or admin, only while NEW)
   ========================================== */

const cancelExpense = async ({
  tenant,
  userId,
  isAdmin,
  expenseNumber,
  ipAddress,
}) => {
  const { models, tenantId } = getContext(tenant);
  const { Expense, AuditLog } = models;

  validateObjectId(userId, "userId");

  const expense = await Expense.findOne({
    tenantId,
    expenseNumber: normalizeCode(expenseNumber),
  });

  if (!expense) throw createError("Expense not found", 404);

  if (!isAdmin && String(expense.createdBy) !== String(userId)) {
    throw createError(
      "Only the creator or an admin can cancel this expense",
      403,
    );
  }

  if (expense.status !== "NEW") {
    throw createError(
      `Only NEW expenses can be cancelled. This expense is ${expense.status}.`,
      409,
    );
  }

  const oldData = expense.toObject();

  expense.status = "CANCELLED";
  expense.cancelledBy = userId;
  expense.cancelledAt = new Date();
  expense.updatedBy = userId;

  try {
    await expense.save();
  } catch (error) {
    if (error?.name === "VersionError") {
      throw createError("The expense changed. Reload and try again.", 409);
    }
    throw error;
  }

  await AuditLog.create({
    tenantId,
    userId,
    action: "UPDATE",
    module: "EXPENSE",
    documentId: expense._id,
    oldData,
    newData: expense.toObject(),
    ipAddress,
  });

  return expense.toObject();
};

/* ==========================================
   LIST + DETAIL
   ========================================== */

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getExpenses = async ({
  tenant,
  search = "",
  status,
  paymentMode,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const { models, tenantId } = getContext(tenant);
  const { currentPage, pageLimit, skip } = getPagination(page, limit);

  const filter = { tenantId };

  if (status) {
    const value = normalizeCode(status);

    if (!["NEW", "APPROVED", "REJECTED", "CANCELLED"].includes(value)) {
      throw createError("Invalid status filter");
    }

    filter.status = value;
  }

  if (paymentMode) filter.paymentMode = normalizeCode(paymentMode);

  if (fromDate || toDate) {
    filter.expenseDate = {};

    let from = null;

    if (fromDate) {
      from = new Date(fromDate);
      if (Number.isNaN(from.getTime()))
        throw createError("fromDate is invalid");
      filter.expenseDate.$gte = from;
    }

    if (toDate) {
      const to = new Date(toDate);
      if (Number.isNaN(to.getTime())) throw createError("toDate is invalid");
      if (from && to < from)
        throw createError("toDate cannot be before fromDate");

      const dateOnly =
        typeof toDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(toDate);

      if (dateOnly) {
        const nextDay = new Date(to);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        filter.expenseDate.$lt = nextDay;
      } else {
        filter.expenseDate.$lte = to;
      }
    }
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const regex = { $regex: escapeRegex(searchText), $options: "i" };

    filter.$or = [
      { expenseNumber: regex },
      { supplierName: regex },
      { payeeName: regex },
      { referenceNumber: regex },
      { "lines.description": regex },
      { "lines.ledgerName": regex },
    ];
  }

  const [data, total] = await Promise.all([
    models.Expense.find(filter)
      .select("-lines.description -requestId")
      .sort({ expenseDate: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean(),

    models.Expense.countDocuments(filter),
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

const getExpenseByNumber = async ({ tenant, expenseNumber }) => {
  const { models, tenantId } = getContext(tenant);

  const number = normalizeCode(expenseNumber);

  if (!number) throw createError("Expense number is required");

  const expense = await models.Expense.findOne({
    tenantId,
    expenseNumber: number,
  })
    .select("-requestId")
    .lean();

  if (!expense) throw createError("Expense not found", 404);

  const journal = expense.journalId
    ? await models.Journal.findOne({ _id: expense.journalId, tenantId })
        .select("journalNumber")
        .lean()
    : null;

  return { ...expense, journalNumber: journal?.journalNumber || null };
};

module.exports = {
  getExpenseOptions,
  createExpense,
  approveExpense,
  rejectExpense,
  cancelExpense,
  getExpenses,
  getExpenseByNumber,
};
