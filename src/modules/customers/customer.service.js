

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

  const normalBalance =
    NORMAL_BALANCE_BY_NATURE[sundryDebtorsGroup.nature];

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

const syncCustomerLedger = async ({
  models,
  customer,
  userId,
  session = null,
}) => {
  if (!customer.ledgerId) {
    return null;
  }

  const { Ledger } = models;

  const options = {
    new: true,
  };

  if (session) {
    options.session = session;
  }

  const ledger = await Ledger.findOneAndUpdate(
    {
      _id: customer.ledgerId,
      tenantId: customer.tenantId,
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
    options,
  );

  if (!ledger) {
    const error = new Error(
      "Linked customer ledger was not found. Customer update was not completed.",
    );

    error.statusCode = 409;

    throw error;
  }

  return ledger;
};

const createCustomer = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
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
        {
          connection,
          session,
        },
      );

      const customerRecords = await Customer.create(
        [
          {
            ...payload,
            customerCode,
            tenantId,
            receivableBalance: 0,
          },
        ],
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
        ledger.currentBalanceType === "DEBIT"
          ? ledger.currentBalance
          : 0;

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

    return createdCustomer;
  } finally {
    await session.endSession();
  }
};

const getCustomers = async ({
  tenant,
  search = "",
  status,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { Customer } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Number(page) || 1, 1);

  const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = status;
  }

  const searchText = String(search || "").trim();

  if (searchText) {
    filter.$or = [
      {
        customerName: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        customerCode: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        phone: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        email: {
          $regex: searchText,
          $options: "i",
        },
      },
    ];
  }

  const [data, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
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
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getCustomerById = async ({
  tenant,
  customerCode,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { Customer } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  return Customer.findOne({
    customerCode: String(customerCode).trim().toUpperCase(),
    tenantId,
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

  const {
    Customer,
    Ledger,
    AuditLog,
  } = getTenantAccountingModels(connection);

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

      const protectedFields = [
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
      ];

      for (const [key, value] of Object.entries(payload || {})) {
        if (!protectedFields.includes(key)) {
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
          {
            new: true,
            session,
          },
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

const deleteCustomer = async ({
  tenant,
  userId,
  customerCode,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Customer,
    Ledger,
    AuditLog,
  } = getTenantAccountingModels(connection);

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
          {
            $set: {
              isActive: false,
              updatedBy: userId,
            },
          },
          {
            new: true,
            session,
          },
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

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};