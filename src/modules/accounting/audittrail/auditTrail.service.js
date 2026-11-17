const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const BOOKS = {
  SALES_INVOICE: {
    label: "Sales Invoice",
    numberField: "invoiceNumber",
    partyField: "customerName",
    dateField: "invoiceDate",
  },
  PURCHASE_BILL: {
    label: "Purchase Bill",
    numberField: "billNumber",
    partyField: "supplierName",
    dateField: "billDate",
  },
};

const ACTIONS = ["CREATE", "UPDATE", "POST", "DELETE"];

// Fields that change on every save and would only add noise to a diff.
const IGNORED_KEYS = new Set(["__v", "updatedAt", "updatedBy"]);

const EXPORT_CAP = 2000;
const MAX_DIFF_ENTRIES = 300;
const MAX_DIFF_DEPTH = 6;


const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveContext = (tenant) => {
  const tenantId = tenant?._id ?? tenant?.id;

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw createError("Resolved tenant context is required", 500);
  }

  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);

  if (!models.AuditLog) {
    throw createError("AuditLog tenant model is unavailable", 500);
  }

  return { models, tenantId };
};

/*
 * Day boundaries follow the viewer's timezone. `tzOffsetMinutes` is the
 * browser's Date#getTimezoneOffset() (e.g. -330 for India).
 */
const parseDay = (value, label, endOfDay, tzOffsetMinutes) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(`${label} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(utc.getTime()) ||
    utc.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`${label} is invalid`);
  }

  const startMs = utc.getTime() + tzOffsetMinutes * 60000;

  return new Date(endOfDay ? startMs + 86400000 - 1 : startMs);
};

const parseOffset = (value) => {
  const offset = Number(value);

  return Number.isFinite(offset) ? Math.max(-840, Math.min(840, offset)) : 0;
};

const scalar = (value) => {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  if (value && typeof value === "object" && typeof value.toHexString === "function") {
    return value.toHexString();
  }

  return value;
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  typeof value.toHexString !== "function";

/* ------------------------------------------------------------------ */
/* diff: before -> after, as a flat list of changed paths              */
/* ------------------------------------------------------------------ */

const diffValues = (before, after, path, out, depth) => {
  if (out.length >= MAX_DIFF_ENTRIES) return;

  const beforeIsNode = Array.isArray(before) || isPlainObject(before);
  const afterIsNode = Array.isArray(after) || isPlainObject(after);

  if ((beforeIsNode || afterIsNode) && depth < MAX_DIFF_DEPTH) {
    // Added / removed structures: compare against an empty counterpart so
    // each leaf is listed on its own (e.g. a new invoice line).
    const left = beforeIsNode ? before : Array.isArray(after) ? [] : {};
    const right = afterIsNode ? after : Array.isArray(before) ? [] : {};

    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);

      for (let index = 0; index < length; index += 1) {
        diffValues(left[index], right[index], `${path}[${index}]`, out, depth + 1);
      }

      return;
    }

    if (isPlainObject(left) && isPlainObject(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

      for (const key of keys) {
        if (IGNORED_KEYS.has(key)) continue;

        diffValues(left[key], right[key], path ? `${path}.${key}` : key, out, depth + 1);
      }

      return;
    }
  }

  const a = scalar(before);
  const b = scalar(after);

  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path, before: a, after: b });
  }
};

const diff = (oldData, newData) => {
  const out = [];

  diffValues(oldData || {}, newData || {}, "", out, 0);

  return out;
};

const topLevelField = (path) => path.split(/[.[]/)[0];

/* ------------------------------------------------------------------ */
/* shaping                                                             */
/* ------------------------------------------------------------------ */

const snapshotOf = (source, cfg) => ({
  number: source[cfg.numberField] || null,
  partyName: source[cfg.partyField] || null,
  date: source[cfg.dateField] || null,
  status: source.status || null,
  paymentStatus: source.paymentStatus || null,
  totalAmountPaise: source.totalAmountPaise ?? null,
  notes: source.notes || null,
  items: (source.items || []).map((item) => ({
    productName: item.productName,
    productCode: item.productCode,
    quantity: item.quantity,
    unit: item.unit,
    unitRatePaise: item.unitRatePaise,
    totalAmountPaise: item.totalAmountPaise,
  })),
});

const shapeEntry = (entry, users, { full = false } = {}) => {
  const cfg = BOOKS[entry.module];
  const source = entry.newData || entry.oldData || {};
  const changes = entry.oldData ? diff(entry.oldData, entry.newData) : [];
  const changedFields = [...new Set(changes.map((c) => topLevelField(c.path)))];

  const row = {
    _id: entry._id,
    createdAt: entry.createdAt,
    module: entry.module,
    moduleLabel: cfg?.label || entry.module,
    action: entry.action,
    documentId: entry.documentId,
    documentNumber: source[cfg?.numberField] || null,
    partyName: source[cfg?.partyField] || null,
    totalAmountPaise: source.totalAmountPaise ?? null,
    statusAfter: source.status || null,
    userId: entry.userId || null,
    userName: users.get(String(entry.userId)) || null,
    ipAddress: entry.ipAddress || null,
    changedCount: changedFields.length,
    changedFields: changedFields.slice(0, 5),
  };

  if (full) {
    row.changes = changes;
    row.snapshot = snapshotOf(source, cfg || {});
  }

  return row;
};

// Resolve user names when a User model is registered on the tenant models.
// Otherwise the UI falls back to the short user id.
const loadUsers = async (models, entries) => {
  const map = new Map();
  const User = models.User;

  const ids = [
    ...new Set(entries.map((e) => e.userId).filter(Boolean).map(String)),
  ];

  if (!User || !ids.length) return map;

  const users = await User.find({ _id: { $in: ids } })
    .select("name fullName firstName lastName email")
    .lean();

  for (const user of users) {
    map.set(
      String(user._id),
      user.name ||
        user.fullName ||
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.email ||
        null,
    );
  }

  return map;
};

/* ------------------------------------------------------------------ */
/* filter                                                              */
/* ------------------------------------------------------------------ */

const buildFilter = (tenantId, args, { ignoreAction = false, ignoreDates = false } = {}) => {
  const filter = { tenantId, module: { $in: Object.keys(BOOKS) } };

  const book = normalizeText(args.module).toUpperCase();

  if (book && book !== "ALL") {
    if (!BOOKS[book]) throw createError("Invalid book");
    filter.module = book;
  }

  const action = normalizeText(args.action).toUpperCase();

  if (action && !ignoreAction) {
    if (!ACTIONS.includes(action)) throw createError("Invalid action");
    filter.action = action;
  }

  if (args.userId) {
    if (!mongoose.isObjectIdOrHexString(args.userId)) {
      throw createError("userId must be a valid ObjectId");
    }

    filter.userId = args.userId;
  }

  if (args.documentId) {
    if (!mongoose.isObjectIdOrHexString(args.documentId)) {
      throw createError("documentId must be a valid ObjectId");
    }

    filter.documentId = args.documentId;
  }

  if (!ignoreDates && (args.startDate || args.endDate)) {
    const offset = parseOffset(args.tzOffsetMinutes);
    const range = {};

    if (args.startDate) range.$gte = parseDay(args.startDate, "From date", false, offset);
    if (args.endDate) range.$lte = parseDay(args.endDate, "To date", true, offset);

    if (range.$gte && range.$lte && range.$gte > range.$lte) {
      throw createError("From date cannot be after To date");
    }

    filter.createdAt = range;
  }

  const searchText = normalizeText(args.search);

  if (searchText) {
    const regex = { $regex: escapeRegex(searchText), $options: "i" };

    filter.$or = [
      { "newData.invoiceNumber": regex },
      { "newData.billNumber": regex },
      { "newData.customerName": regex },
      { "newData.supplierName": regex },
      { "newData.supplierInvoiceNumber": regex },
    ];
  }

  return filter;
};

/* ------------------------------------------------------------------ */
/* 1. Audit entries                                                    */
/* ------------------------------------------------------------------ */

const getAuditTrail = async (args) => {
  const { models, tenantId } = resolveContext(args.tenant);
  const { AuditLog } = models;

  const filter = buildFilter(tenantId, args);
  const countFilter = buildFilter(tenantId, args, { ignoreAction: true });

  const exportAll = String(args.all) === "true";
  const page = Math.max(Math.floor(Number(args.page) || 1), 1);
  const limit = Math.min(Math.max(Math.floor(Number(args.limit) || 25), 1), 100);

  if (exportAll) {
    const total = await AuditLog.countDocuments(filter);

    if (total > EXPORT_CAP) {
      throw createError(
        `${total} entries match. Narrow the filters to ${EXPORT_CAP} entries or fewer.`,
      );
    }
  }

  let query = AuditLog.find(filter).sort({ createdAt: -1, _id: -1 });

  if (!exportAll) query = query.skip((page - 1) * limit).limit(limit);

  const [entries, total, counts] = await Promise.all([
    query.lean(),
    AuditLog.countDocuments(filter),
    AuditLog.aggregate([
      { $match: countFilter },
      { $group: { _id: "$action", count: { $sum: 1 } } },
    ]),
  ]);

  const users = await loadUsers(models, entries);

  const byAction = Object.fromEntries(counts.map((c) => [c._id, c.count]));

  return {
    rows: entries.map((entry) => shapeEntry(entry, users)),
    summary: {
      total: counts.reduce((sum, c) => sum + c.count, 0),
      created: byAction.CREATE || 0,
      edited: byAction.UPDATE || 0,
      posted: byAction.POST || 0,
      deleted: byAction.DELETE || 0,
    },
    pagination: {
      page: exportAll ? 1 : page,
      limit: exportAll ? entries.length : limit,
      total,
      totalPages: exportAll ? 1 : Math.max(1, Math.ceil(total / limit)),
    },
  };
};

/* ------------------------------------------------------------------ */
/* 2. One entry with the full before/after                             */
/* ------------------------------------------------------------------ */

const getAuditEntry = async ({ tenant, id }) => {
  const { models, tenantId } = resolveContext(tenant);

  if (!mongoose.isObjectIdOrHexString(id)) {
    throw createError("Invalid audit entry id");
  }

  const entry = await models.AuditLog.findOne({
    _id: id,
    tenantId,
    module: { $in: Object.keys(BOOKS) },
  }).lean();

  if (!entry) throw createError("Audit entry not found", 404);

  const users = await loadUsers(models, [entry]);

  return { entry: shapeEntry(entry, users, { full: true }) };
};

/* ------------------------------------------------------------------ */
/* 3. Bills that have audit history (powers the bill finder)           */
/* ------------------------------------------------------------------ */

const getAuditDocuments = async (args) => {
  const { models, tenantId } = resolveContext(args.tenant);

  const filter = buildFilter(
    tenantId,
    { module: args.module, search: args.search },
    { ignoreAction: true, ignoreDates: true },
  );

  const page = Math.max(Math.floor(Number(args.page) || 1), 1);
  const limit = Math.min(Math.max(Math.floor(Number(args.limit) || 20), 1), 50);

  const [result] = await models.AuditLog.aggregate([
    { $match: filter },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$documentId",
        module: { $first: "$module" },
        lastAt: { $first: "$createdAt" },
        entries: { $sum: 1 },
        documentNumber: {
          $first: {
            $ifNull: [
              "$newData.invoiceNumber",
              { $ifNull: ["$newData.billNumber", { $ifNull: ["$oldData.invoiceNumber", "$oldData.billNumber"] }] },
            ],
          },
        },
        partyName: {
          $first: {
            $ifNull: [
              "$newData.customerName",
              { $ifNull: ["$newData.supplierName", { $ifNull: ["$oldData.customerName", "$oldData.supplierName"] }] },
            ],
          },
        },
        totalAmountPaise: { $first: "$newData.totalAmountPaise" },
      },
    },
    { $sort: { lastAt: -1, _id: -1 } },
    {
      $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = result?.total?.[0]?.count || 0;

  return {
    data: (result?.data || []).map((row) => ({
      documentId: row._id,
      module: row.module,
      moduleLabel: BOOKS[row.module]?.label || row.module,
      documentNumber: row.documentNumber,
      partyName: row.partyName,
      totalAmountPaise: row.totalAmountPaise ?? null,
      entries: row.entries,
      lastAt: row.lastAt,
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
};

module.exports = {
  getAuditTrail,
  getAuditEntry,
  getAuditDocuments,
  _internals: { diff },
};
