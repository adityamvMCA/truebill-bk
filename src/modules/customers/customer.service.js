const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const NotificationService = require("../../services/notificationService");

const NORMAL_BALANCE_BY_NATURE = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  INCOME: "CREDIT",
  EQUITY: "CREDIT",
};

/* ------------------------------------------------------------------ */
/* List helpers                                                        */
/* ------------------------------------------------------------------ */

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Exact enum values (case-insensitive input -> canonical value) so the
// compound indexes can be used. Case-insensitive regex cannot use them well.
const STATUS_MAP = { active: "Active", inactive: "Inactive" };
const TYPE_MAP = { business: "Business", individual: "Individual" };
const BALANCE_TYPE_MAP = { debit: "DEBIT", credit: "CREDIT" };

const SORTABLE_FIELDS = new Set([
  "customerCode",
  "customerName",
  "contactPerson",
  "phone",
  "email",
  "gstNo",
  "city",
  "state",
  "paymentTerms",
  "creditLimit",
  "creditDays",
  "status",
  "customerType",
  "pincode",
  "country",
  "openingBalance",
  "openingBalanceType",
  "priceList",
  "alternatePhone",
  "panNo",
  "createdAt",
]);

const pick = (map, value) => map[String(value || "").trim().toLowerCase()];

const buildCustomerFilter = ({
  tenantId,
  search,
  status,
  customerType,
  openingBalanceType,
}) => {
  const filter = { tenantId, isDeleted: false };

  const statusValue = pick(STATUS_MAP, status);
  const typeValue = pick(TYPE_MAP, customerType);
  const balanceValue = pick(BALANCE_TYPE_MAP, openingBalanceType);

  if (statusValue) filter.status = statusValue;
  if (typeValue) filter.customerType = typeValue;
  if (balanceValue) filter.openingBalanceType = balanceValue;

  const searchText = String(search || "").trim().slice(0, 100);

  if (searchText) {
    // Prefix match: much faster than "contains" and index friendly.
    const prefix = new RegExp(`^${escapeRegex(searchText)}`, "i");

    filter.$or = [
      { customerCode: prefix },
      { customerName: prefix },
      { contactPerson: prefix },
      { phone: prefix },
      { email: prefix },
      { gstNo: prefix },
      { city: prefix },
    ];
  }

  return filter;
};

/* ------------------------------------------------------------------ */
/* Ledger helpers                                                      */
/* ------------------------------------------------------------------ */

const createCustomerLedger = async ({
  models,
  tenantId,
  userId,
  customer,
  session,
}) => {
  const { Ledger, LedgerGroup } = models;

  const sundryDebtorsGroup = await LedgerGroup.findOne({
    tenantId,
    code: "SUNDRY_DEBTORS",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!sundryDebtorsGroup) {
    const error = new Error(
      "Sundry Debtors ledger group is missing. Seed accounting groups before creating customers.",
    );
    error.statusCode = 400;
    throw error;
  }

  const normalBalance = NORMAL_BALANCE_BY_NATURE[sundryDebtorsGroup.nature];

  if (!normalBalance) {
    const error = new Error(
      "Sundry Debtors ledger group has an invalid account nature.",
    );
    error.statusCode = 400;
    throw error;
  }

  const ledgerCode = `CUST-${customer.customerCode}`.toUpperCase();
  const openingBalance = Number(customer.openingBalance) || 0;

  const ledgers = await Ledger.create(
    [
      {
        tenantId,
        ledgerGroupId: sundryDebtorsGroup._id,
        code: ledgerCode,
        name: customer.customerName,
        type: "CUSTOMER",
        nature: sundryDebtorsGroup.nature,
        normalBalance,

        openingBalance,
        openingBalanceType: customer.openingBalanceType || normalBalance,

        currentBalance: openingBalance,
        currentBalanceType: customer.openingBalanceType || normalBalance,

        referenceType: "CUSTOMER",
        referenceId: customer._id,

        creditLimit: Number(customer.creditLimit) || 0,
        creditDays: Number(customer.creditDays) || 0,

        isSystem: false,
        isActive: customer.status === "Active",

        description: `Customer ledger for ${customer.customerName} (${customer.customerCode})`,

        createdBy: userId,
        updatedBy: userId,
      },
    ],
    { session },
  );

  return ledgers[0];
};

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const createCustomer = async ({ tenant, userId, payload, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);
  const { Customer, AuditLog } = models;
  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let createdCustomer;

    await session.withTransaction(async () => {
      const customerCode = await getNextSequence(
        "CU",
        tenantId.toString(),
        3,
        { connection, session },
      );

      const customerRecords = await Customer.create(
        [{ ...payload, customerCode, tenantId, receivableBalance: 0 }],
        { session },
      );

      const customer = customerRecords[0];

      const ledger = await createCustomerLedger({
        models,
        tenantId,
        userId,
        customer,
        session,
      });

      customer.ledgerId = ledger._id;
      customer.receivableBalance =
        ledger.currentBalanceType === "DEBIT" ? ledger.currentBalance : 0;

      await customer.save({ session });

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "CREATE",
            module: "CUSTOMER",
            documentId: customer._id,
            newData: customer.toObject(),
            ipAddress,
          },
        ],
        { session },
      );

      createdCustomer = customer;
    });

    // Notification must never fail the request after the transaction commits
    try {
      await NotificationService.create({
        tenantId,
        userId,
        type: "NEW_CUSTOMER",
        title: "New customer created",
        message: `${createdCustomer.customerName} (${createdCustomer.customerCode}) was added successfully.`,
        icon: "user-plus",
        priority: "NORMAL",
        route: `/customers/code/${createdCustomer.customerCode}`,
        data: {
          customerId: createdCustomer._id.toString(),
          customerCode: createdCustomer.customerCode,
          ledgerId: createdCustomer.ledgerId?.toString() || null,
        },
      });
    } catch (notificationError) {
      console.error("Customer notification failed:", notificationError);
    }

    return createdCustomer;
  } finally {
    await session.endSession();
  }
};

/* ------------------------------------------------------------------ */
/* List (server-side search / filter / sort / pagination)              */
/* ------------------------------------------------------------------ */

const getCustomers = async ({
  tenant,
  search = "",
  status,
  customerType,
  openingBalanceType,
  sortBy,
  sortOrder,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);
  const { Customer } = getTenantAccountingModels(connection);

  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const filter = buildCustomerFilter({
    tenantId: tenant._id,
    search,
    status,
    customerType,
    openingBalanceType,
  });

  const sortField = SORTABLE_FIELDS.has(sortBy) ? sortBy : "createdAt";
  const sortDirection = sortOrder === "asc" ? 1 : -1;

  const [data, total] = await Promise.all([
    Customer.find(filter)
      .select("-notes -deletedAt -deletedBy -__v")
      .sort({ [sortField]: sortDirection, _id: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    Customer.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageLimit)),
    },
  };
};

/* ------------------------------------------------------------------ */
/* Stats for quick-filter chips                                        */
/* ------------------------------------------------------------------ */

const getCustomerStats = async ({ tenant }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Customer } = getTenantAccountingModels(connection);

  const [row] = await Customer.aggregate([
    { $match: { tenantId: tenant._id, isDeleted: false } },
    {
      $group: {
        _id: null,
        all: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] } },
        inactive: {
          $sum: { $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0] },
        },
        business: {
          $sum: { $cond: [{ $eq: ["$customerType", "Business"] }, 1, 0] },
        },
        individual: {
          $sum: { $cond: [{ $eq: ["$customerType", "Individual"] }, 1, 0] },
        },
      },
    },
  ]);

  return row
    ? {
        all: row.all,
        active: row.active,
        inactive: row.inactive,
        business: row.business,
        individual: row.individual,
      }
    : { all: 0, active: 0, inactive: 0, business: 0, individual: 0 };
};

/* ------------------------------------------------------------------ */
/* Read / update / delete                                              */
/* ------------------------------------------------------------------ */

const getCustomerById = async ({ tenant, customerCode }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Customer } = getTenantAccountingModels(connection);

  return Customer.findOne({
    customerCode: String(customerCode).trim().toUpperCase(),
    tenantId: tenant._id,
    isDeleted: false,
  });
};

const updateCustomer = async ({
  tenant,
  userId,
  customerCode,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);
  const { Customer, Ledger, AuditLog } = getTenantAccountingModels(connection);
  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let updatedCustomer;

    await session.withTransaction(async () => {
      const customer = await Customer.findOne({
        customerCode: String(customerCode).trim().toUpperCase(),
        tenantId,
        isDeleted: false,
      }).session(session);

      if (!customer) {
        const error = new Error("Customer not found");
        error.statusCode = 404;
        throw error;
      }

      const oldData = customer.toObject();

      const protectedFields = new Set([
        "_id",
        "tenantId",
        "customerCode",
        "ledgerId",
        "receivableBalance",
        "isDeleted",
        "deletedAt",
        "deletedBy",
        "createdAt",
        "updatedAt",
        "__v",
      ]);

      for (const [key, value] of Object.entries(payload || {})) {
        if (!protectedFields.has(key)) {
          customer[key] = value;
        }
      }

      await customer.save({ session });

      if (customer.ledgerId) {
        const ledger = await Ledger.findOneAndUpdate(
          {
            _id: customer.ledgerId,
            tenantId,
            type: "CUSTOMER",
            referenceType: "CUSTOMER",
            referenceId: customer._id,
          },
          {
            $set: {
              name: customer.customerName,
              creditLimit: Number(customer.creditLimit) || 0,
              creditDays: Number(customer.creditDays) || 0,
              isActive: customer.status === "Active",
              description: `Customer ledger for ${customer.customerName} (${customer.customerCode})`,
              updatedBy: userId,
            },
          },
          { new: true, session },
        );

        if (!ledger) {
          const error = new Error("Linked customer ledger was not found.");
          error.statusCode = 409;
          throw error;
        }
      }

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "UPDATE",
            module: "CUSTOMER",
            documentId: customer._id,
            oldData,
            newData: customer.toObject(),
            ipAddress,
          },
        ],
        { session },
      );

      updatedCustomer = customer;
    });

    return updatedCustomer;
  } finally {
    await session.endSession();
  }
};

const deleteCustomer = async ({ tenant, userId, customerCode, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Customer, Ledger, AuditLog } = getTenantAccountingModels(connection);
  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let deletedCustomer;

    await session.withTransaction(async () => {
      const customer = await Customer.findOne({
        customerCode: String(customerCode).trim().toUpperCase(),
        tenantId,
        isDeleted: false,
      }).session(session);

      if (!customer) {
        const error = new Error("Customer not found");
        error.statusCode = 404;
        throw error;
      }

      const oldData = customer.toObject();

      customer.isDeleted = true;
      customer.deletedAt = new Date();
      customer.deletedBy = userId;

      await customer.save({ session });

      if (customer.ledgerId) {
        const ledger = await Ledger.findOneAndUpdate(
          {
            _id: customer.ledgerId,
            tenantId,
            type: "CUSTOMER",
            referenceType: "CUSTOMER",
            referenceId: customer._id,
          },
          { $set: { isActive: false, updatedBy: userId } },
          { new: true, session },
        );

        if (!ledger) {
          const error = new Error("Linked customer ledger was not found.");
          error.statusCode = 409;
          throw error;
        }
      }

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "DELETE",
            module: "CUSTOMER",
            documentId: customer._id,
            oldData,
            newData: customer.toObject(),
            ipAddress,
          },
        ],
        { session },
      );

      deletedCustomer = customer;
    });

    return deletedCustomer;
  } finally {
    await session.endSession();
  }
};
const bulkUpdateStatus = async ({ tenant, userId, payload, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Customer, AuditLog } = getTenantAccountingModels(connection);
  const tenantId = tenant._id;

  const { ids, status } = payload;

  const customers = await Customer.find({
    _id: { $in: ids },
    tenantId,
    isDeleted: false,
  });

  if (!customers.length) {
    const error = new Error("No customers found for the given ids.");
    error.statusCode = 404;
    throw error;
  }

  const session = await connection.startSession();

  try {
    let updated = 0;

    await session.withTransaction(async () => {
      const result = await Customer.updateMany(
        { _id: { $in: ids }, tenantId, isDeleted: false },
        { $set: { status } },
        { session }
      );

      updated = result.modifiedCount || 0;

      const affected = customers.filter((c) => c.status !== status);
      const skipped = customers.length - affected.length;

      if (affected.length) {
        await AuditLog.insertMany(
          affected.map((customer) => ({
            tenantId,
            userId,
            action: "UPDATE",
            module: "CUSTOMER",
            documentId: customer._id,
            oldData: { status: customer.status },
            newData: { status },
            ipAddress,
          })),
          { session }
        );
      }

      return { updated, skipped };
    });

    return {
      message: `${updated} customer(s) updated successfully.`,
      updated,
      skippedCount: customers.length - updated,
    };
  } finally {
    await session.endSession();
  }
};
module.exports = {
  createCustomer,
  getCustomers,
  getCustomerStats,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  bulkUpdateStatus
};