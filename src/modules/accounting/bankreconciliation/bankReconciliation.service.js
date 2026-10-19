const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../../utils/sequenceGenerator");

const BANK_LEDGER_CODE_PATTERN = /^BK/i;
const STATUS_FILTERS = ["OPEN", "UNCLEARED", "CLEARED", "RECONCILED"];
const MAX_CLEAR_ITEMS = 500;

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }

  return value;
};

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const parseDate = (value, fieldName, endOfDay = false) => {
  const text = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError(`${fieldName} must be a valid date (YYYY-MM-DD)`);
  }

  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${text}T${time}Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const todayUtc = () =>
  new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

const parseAmountToPaise = (value) => {
  const text = normalizeText(value);

  if (!text) return null;

  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) {
    throw createError(
      "Statement balance must be a valid amount with at most two decimal places",
    );
  }

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  return negative && paise !== 0 ? -paise : paise;
};

const formatRupees = (paise) => (Math.abs(paise) / 100).toFixed(2);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveContext = ({ tenant, ...rest }) => {
  const tenantId = tenant?._id ?? tenant?.id;

  validateObjectId(tenantId, "tenantId");

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  for (const name of [
    "Journal",
    "Ledger",
    "BankClearing",
    "BankReconciliation",
    "AuditLog",
  ]) {
    if (!models[name]) {
      throw createError(`Tenant model ${name} is unavailable`, 500);
    }
  }

  return {
    ...rest,
    tenant,
    tenantId,
    tenantObjectId: toObjectId(tenantId),
    connection,
    models,
  };
};

const runTransaction = async (args, operation) => {
  const context = resolveContext(args);

  validateObjectId(context.userId, "userId");

  const session = await context.connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({ ...context, session });
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const runAggregate = async (model, pipeline, session) => {
  const aggregate = model.aggregate(pipeline);

  if (session) aggregate.session(session);

  return aggregate;
};

const getBankLedger = async ({
  models,
  tenantObjectId,
  bankLedgerId,
  session,
}) => {
  validateObjectId(bankLedgerId, "bankLedgerId");

  const query = models.Ledger.findOne({
    _id: bankLedgerId,
    tenantId: tenantObjectId,
    isActive: true,
  });

  if (session) query.session(session);

  const ledger = await query.lean();

  if (!ledger) {
    throw createError("Bank account not found", 404);
  }

  if (!BANK_LEDGER_CODE_PATTERN.test(ledger.code)) {
    throw createError("The selected ledger is not a bank account", 409);
  }

  return ledger;
};

const signedBalancePaise = (ledger) => {
  if (!["DEBIT", "CREDIT"].includes(ledger.currentBalanceType)) {
    throw createError(
      `Ledger ${ledger.code} has an invalid current balance type`,
      409,
    );
  }

  const magnitude = Math.round(Number(ledger.currentBalance || 0) * 100);

  if (!Number.isSafeInteger(magnitude)) {
    throw createError("Ledger balance exceeds the supported range");
  }

  return ledger.currentBalanceType === "DEBIT" ? magnitude : -magnitude;
};

const buildBasePipeline = ({ models, tenantObjectId, bankObjectId, asOf }) => [
  { $match: { tenantId: tenantObjectId, postingDate: { $lte: asOf } } },
  { $unwind: { path: "$lines", includeArrayIndex: "lineIndex" } },
  { $match: { "lines.ledgerId": bankObjectId } },
  {
    $lookup: {
      from: models.BankClearing.collection.name,
      let: { journalId: "$_id", lineIndex: "$lineIndex" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$tenantId", tenantObjectId] },
                { $eq: ["$bankLedgerId", bankObjectId] },
                { $eq: ["$journalId", "$$journalId"] },
                { $eq: ["$lineIndex", "$$lineIndex"] },
              ],
            },
          },
        },
        { $limit: 1 },
      ],
      as: "clearing",
    },
  },
  { $addFields: { clearing: { $arrayElemAt: ["$clearing", 0] } } },
  {
    $addFields: {
      state: {
        $cond: [
          { $not: ["$clearing"] },
          "UNCLEARED",
          {
            $cond: [
              { $ifNull: ["$clearing.reconciliationId", false] },
              "RECONCILED",
              "CLEARED",
            ],
          },
        ],
      },
      effectPaise: { $subtract: ["$lines.debitPaise", "$lines.creditPaise"] },
    },
  },
];

const buildFilterStages = ({ status, search }) => {
  const stages = [];

  if (status === "OPEN") {
    stages.push({ $match: { state: { $ne: "RECONCILED" } } });
  } else {
    stages.push({ $match: { state: status } });
  }

  const term = normalizeText(search);

  if (term) {
    const regex = { $regex: escapeRegex(term), $options: "i" };

    stages.push({
      $match: {
        $or: [
          { journalNumber: regex },
          { sourceNumber: regex },
          { narration: regex },
          { "lines.narration": regex },
        ],
      },
    });
  }

  return stages;
};

const computeReconciliation = async ({
  models,
  tenantObjectId,
  ledger,
  asOf,
  statementPaise,
  session,
}) => {
  const bankObjectId = ledger._id;

  const afterRows = await runAggregate(
    models.Journal,
    [
      { $match: { tenantId: tenantObjectId, postingDate: { $gt: asOf } } },
      { $unwind: "$lines" },
      { $match: { "lines.ledgerId": bankObjectId } },
      {
        $group: {
          _id: null,
          debitPaise: { $sum: "$lines.debitPaise" },
          creditPaise: { $sum: "$lines.creditPaise" },
        },
      },
    ],
    session,
  );

  const stateRows = await runAggregate(
    models.Journal,
    [
      ...buildBasePipeline({ models, tenantObjectId, bankObjectId, asOf }),
      {
        $group: {
          _id: "$state",
          count: { $sum: 1 },
          debitPaise: { $sum: "$lines.debitPaise" },
          creditPaise: { $sum: "$lines.creditPaise" },
        },
      },
    ],
    session,
  );

  const empty = { count: 0, debitPaise: 0, creditPaise: 0 };
  const after = afterRows[0] || empty;
  const byState = new Map(stateRows.map((row) => [row._id, row]));

  const uncleared = byState.get("UNCLEARED") || empty;
  const cleared = byState.get("CLEARED") || empty;
  const reconciled = byState.get("RECONCILED") || empty;

  const bookBalancePaise =
    signedBalancePaise(ledger) - (after.debitPaise - after.creditPaise);

  const unclearedNetPaise = uncleared.debitPaise - uncleared.creditPaise;
  const clearedBalancePaise = bookBalancePaise - unclearedNetPaise;

  return {
    bookBalancePaise,
    statementBalancePaise: statementPaise,
    clearedBalancePaise,
    unclearedDebitPaise: uncleared.debitPaise,
    unclearedCreditPaise: uncleared.creditPaise,
    unclearedCount: uncleared.count,
    clearedCount: cleared.count,
    reconciledCount: reconciled.count,
    differencePaise:
      statementPaise === null ? null : statementPaise - clearedBalancePaise,
  };
};

const getBankAccounts = async ({ tenant }) => {
  const { models, tenantObjectId } = resolveContext({ tenant });

  const ledgers = await models.Ledger.find({
    tenantId: tenantObjectId,
    isActive: true,
    code: BANK_LEDGER_CODE_PATTERN,
  })
    .select("_id code name currentBalance currentBalanceType")
    .sort({ code: 1 })
    .lean();

  const lastRows = await models.BankReconciliation.aggregate([
    { $match: { tenantId: tenantObjectId, status: "COMPLETED" } },
    { $sort: { statementDate: -1, createdAt: -1 } },
    {
      $group: {
        _id: "$bankLedgerId",
        reconciliationNumber: { $first: "$reconciliationNumber" },
        statementDate: { $first: "$statementDate" },
        statementBalancePaise: { $first: "$statementBalancePaise" },
      },
    },
  ]);

  const lastByBank = new Map(lastRows.map((row) => [String(row._id), row]));

  return ledgers.map((ledger) => {
    let balancePaise = null;

    try {
      balancePaise = signedBalancePaise(ledger);
    } catch (error) {
      balancePaise = null;
    }

    return {
      _id: ledger._id,
      code: ledger.code,
      name: ledger.name,
      balancePaise,
      lastReconciliation: lastByBank.get(String(ledger._id)) || null,
    };
  });
};

const getBankReconciliation = async ({
  tenant,
  bankLedgerId,
  statementDate,
  statementBalance,
  status,
  search,
  page = 1,
  limit = 10,
}) => {
  const { models, tenantObjectId } = resolveContext({ tenant });

  const asOf = parseDate(statementDate, "statementDate", true);
  const statementPaise = parseAmountToPaise(statementBalance);

  const normalizedStatus = normalizeText(status || "OPEN").toUpperCase();

  if (!STATUS_FILTERS.includes(normalizedStatus)) {
    throw createError("Unsupported status filter");
  }

  const currentPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 10, 1),
    100,
  );

  const ledger = await getBankLedger({
    models,
    tenantObjectId,
    bankLedgerId,
  });

  const summary = await computeReconciliation({
    models,
    tenantObjectId,
    ledger,
    asOf,
    statementPaise,
  });

  const stages = buildFilterStages({
    status: normalizedStatus,
    search,
  });

  const [facet] = await runAggregate(models.Journal, [
    ...buildBasePipeline({
      models,
      tenantObjectId,
      bankObjectId: ledger._id,
      asOf,
    }),
    {
      $facet: {
        data: [
          ...stages,
          { $sort: { postingDate: -1, journalNumber: -1, lineIndex: -1 } },
          { $skip: (currentPage - 1) * pageLimit },
          { $limit: pageLimit },
          {
            $project: {
              _id: 0,
              journalId: "$_id",
              journalNumber: 1,
              postingDate: 1,
              sourceType: 1,
              sourceNumber: 1,
              lineIndex: 1,
              narration: { $ifNull: ["$lines.narration", "$narration"] },
              debitPaise: "$lines.debitPaise",
              creditPaise: "$lines.creditPaise",
              state: 1,
              clearedDate: "$clearing.clearedDate",
            },
          },
        ],
        total: [...stages, { $count: "count" }],
      },
    },
  ]);

  const total = facet?.total?.[0]?.count || 0;

  const lastReconciliation = await models.BankReconciliation.findOne({
    tenantId: tenantObjectId,
    bankLedgerId: ledger._id,
    status: "COMPLETED",
  })
    .sort({ statementDate: -1, createdAt: -1 })
    .select("reconciliationNumber statementDate statementBalancePaise")
    .lean();

  return {
    bank: { _id: ledger._id, code: ledger.code, name: ledger.name },
    period: { statementDate: normalizeText(statementDate) },
    summary,
    lastReconciliation,
    rows: facet?.data || [],
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const setCleared = async ({
  tenant,
  userId,
  bankLedgerId,
  items,
  clear,
  clearedDate,
}) => {
  if (!Array.isArray(items) || !items.length || items.length > MAX_CLEAR_ITEMS) {
    throw createError(
      `Select between 1 and ${MAX_CLEAR_ITEMS} transactions to update`,
    );
  }

  if (typeof clear !== "boolean") {
    throw createError("clear must be true or false");
  }

  const seen = new Set();
  const uniqueItems = [];

  for (const item of items) {
    validateObjectId(item?.journalId, "journalId");

    if (!Number.isInteger(item.lineIndex) || item.lineIndex < 0) {
      throw createError("lineIndex must be a non-negative integer");
    }

    const key = `${item.journalId}:${item.lineIndex}`;

    if (!seen.has(key)) {
      seen.add(key);
      uniqueItems.push({ journalId: String(item.journalId), lineIndex: item.lineIndex });
    }
  }

  const resolvedClearedDate = clearedDate
    ? parseDate(clearedDate, "clearedDate")
    : todayUtc();

  return runTransaction(
    { tenant, userId },
    async ({ models, tenantObjectId, session }) => {
      const ledger = await getBankLedger({
        models,
        tenantObjectId,
        bankLedgerId,
        session,
      });

      const journals = await models.Journal.find({
        tenantId: tenantObjectId,
        _id: { $in: uniqueItems.map((item) => item.journalId) },
      })
        .session(session)
        .select("postingDate lines.ledgerId lines.debitPaise lines.creditPaise")
        .lean();

      const journalById = new Map(
        journals.map((journal) => [String(journal._id), journal]),
      );

      for (const item of uniqueItems) {
        const journal = journalById.get(item.journalId);
        const line = journal?.lines?.[item.lineIndex];

        if (!line || String(line.ledgerId) !== String(ledger._id)) {
          throw createError(
            "A selected transaction does not belong to this bank account",
            409,
          );
        }
      }

      const existing = await models.BankClearing.find({
        tenantId: tenantObjectId,
        bankLedgerId: ledger._id,
        $or: uniqueItems.map((item) => ({
          journalId: item.journalId,
          lineIndex: item.lineIndex,
        })),
      })
        .session(session)
        .lean();

      if (existing.some((entry) => entry.reconciliationId)) {
        throw createError(
          "Reconciled transactions cannot be changed. Undo the reconciliation first.",
          409,
        );
      }

      if (!clear) {
        const result = await models.BankClearing.deleteMany(
          { _id: { $in: existing.map((entry) => entry._id) } },
          { session },
        );

        return { updated: result.deletedCount || 0 };
      }

      const existingKeys = new Set(
        existing.map((entry) => `${entry.journalId}:${entry.lineIndex}`),
      );

      const documents = uniqueItems
        .filter((item) => !existingKeys.has(`${item.journalId}:${item.lineIndex}`))
        .map((item) => {
          const journal = journalById.get(item.journalId);
          const line = journal.lines[item.lineIndex];

          return {
            tenantId: tenantObjectId,
            bankLedgerId: ledger._id,
            journalId: item.journalId,
            lineIndex: item.lineIndex,
            postingDate: journal.postingDate,
            effectPaise: (line.debitPaise || 0) - (line.creditPaise || 0),
            clearedDate: resolvedClearedDate,
            reconciliationId: null,
            createdBy: userId,
          };
        });

      if (documents.length) {
        await models.BankClearing.insertMany(documents, {
          session,
          ordered: true,
        });
      }

      return { updated: documents.length };
    },
  );
};

const finalizeReconciliation = async ({
  tenant,
  userId,
  ipAddress,
  bankLedgerId,
  statementDate,
  statementBalance,
  notes,
}) => {
  const asOf = parseDate(statementDate, "statementDate", true);
  const statementDay = parseDate(statementDate, "statementDate");
  const statementPaise = parseAmountToPaise(statementBalance);

  if (statementPaise === null) {
    throw createError("Statement closing balance is required");
  }

  return runTransaction(
    { tenant, userId },
    async ({ models, tenantId, tenantObjectId, connection, session }) => {
      const ledger = await getBankLedger({
        models,
        tenantObjectId,
        bankLedgerId,
        session,
      });

      const last = await models.BankReconciliation.findOne({
        tenantId: tenantObjectId,
        bankLedgerId: ledger._id,
        status: "COMPLETED",
      })
        .sort({ statementDate: -1, createdAt: -1 })
        .session(session)
        .lean();

      if (last && statementDay < new Date(last.statementDate)) {
        throw createError(
          "Statement date cannot be before the last reconciled statement date",
          409,
        );
      }

      const summary = await computeReconciliation({
        models,
        tenantObjectId,
        ledger,
        asOf,
        statementPaise,
        session,
      });

      if (summary.clearedCount < 1) {
        throw createError("Mark at least one transaction as cleared", 400);
      }

      if (summary.differencePaise !== 0) {
        throw createError(
          `A difference of ₹${formatRupees(summary.differencePaise)} remains. It must be zero to complete the reconciliation`,
          409,
        );
      }

      const reconciliationNumber = await getNextSequence(
        "BR",
        String(tenantId),
        3,
        { connection, session },
      );

      const [record] = await models.BankReconciliation.create(
        [
          {
            tenantId: tenantObjectId,
            reconciliationNumber,
            bankLedgerId: ledger._id,
            bankLedgerCode: ledger.code,
            bankLedgerName: ledger.name,
            statementDate: statementDay,
            statementBalancePaise: statementPaise,
            bookBalancePaise: summary.bookBalancePaise,
            clearedBalancePaise: summary.clearedBalancePaise,
            unclearedDebitPaise: summary.unclearedDebitPaise,
            unclearedCreditPaise: summary.unclearedCreditPaise,
            clearedCount: summary.clearedCount,
            notes: normalizeText(notes) || null,
            status: "COMPLETED",
            createdBy: userId,
          },
        ],
        { session, ordered: true },
      );

      await models.BankClearing.updateMany(
        {
          tenantId: tenantObjectId,
          bankLedgerId: ledger._id,
          reconciliationId: null,
          postingDate: { $lte: asOf },
        },
        { $set: { reconciliationId: record._id } },
        { session },
      );

      await models.AuditLog.create(
        [
          {
            tenantId: tenantObjectId,
            userId,
            action: "RECONCILE",
            module: "BANK_RECONCILIATION",
            documentId: record._id,
            oldData: null,
            newData: record.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );

      return record;
    },
  );
};

const undoReconciliation = async ({
  tenant,
  userId,
  ipAddress,
  reconciliationId,
}) => {
  validateObjectId(reconciliationId, "reconciliationId");

  return runTransaction(
    { tenant, userId },
    async ({ models, tenantObjectId, session }) => {
      const record = await models.BankReconciliation.findOne({
        _id: reconciliationId,
        tenantId: tenantObjectId,
      }).session(session);

      if (!record) {
        throw createError("Reconciliation not found", 404);
      }

      if (record.status !== "COMPLETED") {
        throw createError("This reconciliation is already reversed", 409);
      }

      const newer = await models.BankReconciliation.findOne({
        tenantId: tenantObjectId,
        bankLedgerId: record.bankLedgerId,
        status: "COMPLETED",
        _id: { $ne: record._id },
        $or: [
          { statementDate: { $gt: record.statementDate } },
          {
            statementDate: record.statementDate,
            createdAt: { $gt: record.createdAt },
          },
        ],
      })
        .session(session)
        .select("_id")
        .lean();

      if (newer) {
        throw createError(
          "Only the latest reconciliation for a bank account can be undone",
          409,
        );
      }

      const oldData = record.toObject();

      await models.BankClearing.updateMany(
        { tenantId: tenantObjectId, reconciliationId: record._id },
        { $set: { reconciliationId: null } },
        { session },
      );

      record.status = "REVERSED";
      record.reversedAt = new Date();
      record.reversedBy = userId;

      await record.save({ session });

      await models.AuditLog.create(
        [
          {
            tenantId: tenantObjectId,
            userId,
            action: "UNDO_RECONCILIATION",
            module: "BANK_RECONCILIATION",
            documentId: record._id,
            oldData,
            newData: record.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );

      return record;
    },
  );
};

const getHistory = async ({ tenant, bankLedgerId, page = 1, limit = 10 }) => {
  const { models, tenantObjectId } = resolveContext({ tenant });

  validateObjectId(bankLedgerId, "bankLedgerId");

  const currentPage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 10, 1),
    100,
  );

  const filter = { tenantId: tenantObjectId, bankLedgerId };

  const [data, total] = await Promise.all([
    models.BankReconciliation.find(filter)
      .sort({ statementDate: -1, createdAt: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    models.BankReconciliation.countDocuments(filter),
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

module.exports = {
  getBankAccounts,
  getBankReconciliation,
  setCleared,
  finalizeReconciliation,
  undoReconciliation,
  getHistory,
};