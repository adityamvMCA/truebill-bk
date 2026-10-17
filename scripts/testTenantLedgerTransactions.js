const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const mongoose = require("mongoose");

const envResult = require("dotenv").config({
  path: path.resolve(__dirname, "../.env.tenant-test"),
  quiet: true,
});

const {
  getTenantDatabaseName,
} = require("../src/tenancy/tenantDatabaseNames");

const {
  getProvisioningConnection,
} = require("../src/tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../src/tenancy/tenantAccountingModels");

const {
  DEFAULT_LEDGER_GROUPS,
  seedDefaultLedgerGroups,
} = require(
  "../src/modules/accounting/seeds/seedDefaultLedgerGroups",
);

const {
  DEFAULT_LEDGERS,
  seedDefaultLedgers,
} = require(
  "../src/modules/accounting/seeds/seedDefaultLedgers",
);

const customerService = require(
  "../src/modules/customers/customer.service",
);

const supplierService = require(
  "../src/modules/suppliers/supplier.service",
);

const productService = require(
  "../src/modules/products/product.service",
);

const salesInvoiceService = require(
  "../src/modules/sales-invoices/salesInvoice.service",
);

const purchaseBillService = require(
  "../src/modules/purchase-bills/purchaseBill.service",
);

const customerReceiptService = require(
  "../src/modules/customer-receipts/customerReceipt.service",
);

const supplierPaymentService = require(
  "../src/modules/supplier-payments/supplierPayment.service",
);

const bankService = require(
  "../src/modules/banks/bank.service",
);

const {
  getLedgerTransactions,
} = require(
  "../src/modules/accounting/ledgers/ledgerTransaction.controller",
);

const NotificationService = require(
  "../src/services/notificationService",
);

const contexts = [];
const createdDatabases = [];

const MODEL_NAMES = [
  "LedgerGroup",
  "Ledger",
  "Customer",
  "Supplier",
  "Product",
  "SalesInvoice",
  "PurchaseBill",
  "CustomerReceipt",
  "SupplierPayment",
  "Journal",
  "Bank",
  "StockMovement",
  "AuditLog",
];

const validateConfiguration = () => {
  if (!process.argv.includes("--run")) {
    throw new Error("Explicit --run argument is required.");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("This test must not run in production mode.");
  }

  if (envResult.error) {
    throw new Error("Could not load .env.tenant-test.");
  }

  const settings = envResult.parsed || {};

  const uri = settings.TENANT_TEST_MONGO_URI?.trim();

  const expectedMainDb =
    settings.TENANT_TEST_EXPECTED_MAIN_DB?.trim();

  if (
    !uri ||
    (
      !uri.startsWith("mongodb://") &&
      !uri.startsWith("mongodb+srv://")
    )
  ) {
    throw new Error("A valid TENANT_TEST_MONGO_URI is required.");
  }

  if (
    !expectedMainDb ||
    !/^truebill_test_[a-z0-9_]+$/.test(expectedMainDb) ||
    Buffer.byteLength(expectedMainDb, "utf8") > 38
  ) {
    throw new Error(
      "Expected main database must start with truebill_test_ and be at most 38 bytes.",
    );
  }

  return { uri, expectedMainDb };
};

const createTenantContext = (label) => {
  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const databaseKey = `test_${randomBytes(6).toString("hex")}`;
  const databaseName = getTenantDatabaseName(databaseKey);

  const tenant = {
    _id: tenantId,
    businessName: `Ledger Transaction Test ${label}`,
    databaseKey,
    databaseName,
    storageMode: "DEDICATED",
    provisioningStatus: "PROVISIONING",
    isActive: true,
    status: "active",
  };

  const connection = getProvisioningConnection(tenant);
  const models = getTenantAccountingModels(connection);

  const context = {
    label,
    tenant,
    tenantId,
    userId,
    databaseName,
    connection,
    models,
  };

  contexts.push(context);

  return context;
};

const getReadyTenant = (context) => ({
  ...context.tenant,
  provisioningStatus: "READY",
});

const requestContext = (context) => ({
  tenant: getReadyTenant(context),
  userId: context.userId,
  ipAddress: "127.0.0.1",
});

const provisionTenant = async (context) => {
  const {
    connection,
    models,
    tenantId,
    databaseName,
  } = context;

  assert.notEqual(
    databaseName,
    mongoose.connection.name,
    "Tenant database must not be the main database",
  );

  assert.equal(connection.name, databaseName);

  const collections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  assert.equal(
    collections.length,
    0,
    "Refusing to reuse an existing test database",
  );

  for (const name of MODEL_NAMES) {
    assert.ok(models[name], `Tenant model is missing: ${name}`);

    assert.equal(
      models[name].db,
      connection,
      `Tenant model has the wrong connection: ${name}`,
    );
  }

  createdDatabases.push(databaseName);

  for (const name of MODEL_NAMES) {
    await models[name].createCollection();
    await models[name].createIndexes();
  }

  await connection.db.createCollection("counters");

  const session = await connection.startSession();

  try {
    await session.withTransaction(async () => {
      await seedDefaultLedgerGroups({
        tenantId,
        models,
        session,
        userId: null,
      });

      await seedDefaultLedgers({
        tenantId,
        models,
        session,
        userId: null,
      });
    });
  } finally {
    await session.endSession();
  }

  assert.equal(
    await models.LedgerGroup.countDocuments({ tenantId }),
    DEFAULT_LEDGER_GROUPS.length,
  );

  assert.equal(
    await models.Ledger.countDocuments({ tenantId }),
    DEFAULT_LEDGERS.length,
  );

  console.log(`${context.label} provisioned: ${databaseName}`);
};

const snapshotTenant = async (context) => {
  const snapshot = {};

  for (const name of MODEL_NAMES) {
    let query = context.models[name].find({});

    if (
      name === "CustomerReceipt" ||
      name === "SupplierPayment"
    ) {
      query = query.select("+requestHash");
    }

    const records = await query.sort({ _id: 1 }).lean();

    snapshot[name] = JSON.stringify(records);
  }

  const counters = await context.connection.db
    .collection("counters")
    .find({})
    .sort({ _id: 1 })
    .toArray();

  snapshot.counters = JSON.stringify(counters);

  return snapshot;
};

const getUtcDay = (date = new Date()) =>
  date.toISOString().slice(0, 10);

const shiftDay = (day, offset) => {
  const date = new Date(`${day}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + offset);

  return date.toISOString().slice(0, 10);
};

const makeDates = () => {
  const today = getUtcDay();

  return {
    today,
    priorDay: shiftDay(today, -10),
    priorDate: `${shiftDay(today, -10)}T00:00:00.000Z`,
    currentDate: `${today}T00:00:00.000Z`,
    futureDate: `${shiftDay(today, 7)}T00:00:00.000Z`,
  };
};

const createFixtures = async (context, dates) => {
  const customer = await customerService.createCustomer({
    ...requestContext(context),
    payload: {
      customerName: `${context.label} Customer`,
      customerType: "Business",
      paymentTerms: "Due on Receipt",
      openingBalance: 0,
      openingBalanceType: "DEBIT",
      creditLimit: 100000,
      creditDays: 30,
      status: "Active",
      country: "India",
      priceList: "Standard",
    },
  });

  const supplier = await supplierService.createSupplier({
    ...requestContext(context),
    payload: {
      supplierName: `${context.label} Supplier`,
      supplierType: "Business",
      gstNo: "27ABCDE1234F1Z5",
      paymentTerms: "Due on Receipt",
      openingBalance: 0,
      openingBalanceType: "CREDIT",
      creditLimit: 100000,
      creditDays: 30,
      status: "Active",
      country: "India",
    },
  });

  const product = await productService.createProduct({
    ...requestContext(context),
    payload: {
      name: `${context.label} Ledger Service`,
      type: "SERVICE",
      unit: "HOUR",
      gstRate: 18,
      salePrice: 100,
      purchasePrice: 100,
      trackInventory: false,
      openingStock: 0,
      openingStockRate: 0,
      reorderLevel: 0,
      status: "ACTIVE",
    },
  });

  const cash = await context.models.Ledger.findOne({
    tenantId: context.tenantId,
    code: "CASH",
    type: "CASH",
    nature: "ASSET",
    isActive: true,
  });

  assert.ok(cash, "Seeded CASH Ledger is missing");

  cash.openingBalance = 10000;
  cash.openingBalanceType = "DEBIT";
  cash.currentBalance = 10000;
  cash.currentBalanceType = "DEBIT";

  await cash.save();

  const bank = await bankService.createBank({
    ...requestContext(context),
    payload: {
      bankName: `${context.label} Bank`,
      accountName: `${context.label} Bank Account`,
      accountHolderName: `${context.label} Holder`,
      accountNumber: "1234567890",
      accountType: "CURRENT",
      branchName: "Test Branch",
      ifscCode: "SBIN0000001",
      openingBalance: 0,
      openingBalanceType: "DEBIT",
      status: "ACTIVE",
    },
  });

  assert.ok(bank.bankCode, "Bank service did not return bankCode");

  const bankLedger = await context.models.Ledger.findOne({
    tenantId: context.tenantId,
    _id: bank.ledgerId,
  });

  assert.ok(bankLedger, "Bank Ledger is missing");

  bankLedger.openingBalance = 5000;
  bankLedger.openingBalanceType = "DEBIT";
  bankLedger.currentBalance = 5000;
  bankLedger.currentBalanceType = "DEBIT";

  await bankLedger.save();

  const priorInvoice = await salesInvoiceService
    .createSalesInvoice({
      ...requestContext(context),
      payload: {
        action: "SAVE_AND_POST",
        customerId: customer._id.toString(),
        invoiceDate: dates.priorDate,
        dueDate: dates.futureDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRA_STATE",
        updateStock: false,
        items: [
          {
            productId: product._id.toString(),
            quantity: 1,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
          },
        ],
      },
    });

  const currentInvoice = await salesInvoiceService
    .createSalesInvoice({
      ...requestContext(context),
      payload: {
        action: "SAVE_AND_POST",
        customerId: customer._id.toString(),
        invoiceDate: dates.currentDate,
        dueDate: dates.futureDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRA_STATE",
        updateStock: false,
        items: [
          {
            productId: product._id.toString(),
            quantity: 2,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
          },
        ],
      },
    });

  const currentBill = await purchaseBillService
    .createPurchaseBill({
      ...requestContext(context),
      payload: {
        action: "SAVEANDPOST",
        supplierId: supplier._id.toString(),
        supplierInvoiceNumber: `LEDGER-${randomUUID()}`,
        billDate: dates.currentDate,
        dueDate: dates.futureDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRASTATE",
        updateStock: false,
        items: [
          {
            productId: product._id.toString(),
            quantity: 1,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
            taxCreditEligible: true,
          },
        ],
      },
    });

  const draftInvoice = await salesInvoiceService
    .createSalesInvoice({
      ...requestContext(context),
      payload: {
        action: "SAVE_DRAFT",
        customerId: customer._id.toString(),
        invoiceDate: dates.currentDate,
        dueDate: dates.futureDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRA_STATE",
        updateStock: false,
        items: [
          {
            productId: product._id.toString(),
            quantity: 99,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
          },
        ],
      },
    });

  assert.equal(priorInvoice.status, "POSTED");
  assert.equal(currentInvoice.status, "POSTED");
  assert.equal(currentBill.status, "POSTED");
  assert.equal(draftInvoice.status, "DRAFT");

  await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload: {
      requestId: randomUUID(),
      customerId: customer._id.toString(),
      receiptLedgerId: cash._id.toString(),
      receiptDate: dates.priorDate,
      receiptMethod: "CASH",
      amount: 100,
      allocations: [
        {
          salesInvoiceId: priorInvoice._id.toString(),
          amount: 100,
        },
      ],
    },
  });

  await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload: {
      requestId: randomUUID(),
      customerId: customer._id.toString(),
      receiptLedgerId: bank.ledgerId.toString(),
      receiptDate: dates.currentDate,
      receiptMethod: "BANK_TRANSFER",
      amount: 200,
      allocations: [
        {
          salesInvoiceId: currentInvoice._id.toString(),
          amount: 200,
        },
      ],
    },
  });

  await supplierPaymentService.createSupplierPayment({
    ...requestContext(context),
    payload: {
      requestId: randomUUID(),
      supplierId: supplier._id.toString(),
      paymentLedgerId: cash._id.toString(),
      paymentDate: dates.currentDate,
      paymentMethod: "CASH",
      amount: 100,
      allocations: [
        {
          purchaseBillId: currentBill._id.toString(),
          amount: 100,
        },
      ],
    },
  });

  console.log(
    `PASS: ${context.label} prior-period, current-period, Bank, and draft fixtures created`,
  );

  return {
    customer,
    supplier,
    product,
    cash,
    bank,
    bankCode: bank.bankCode,
    bankLedger,
    priorInvoice,
    currentInvoice,
    currentBill,
    draftInvoice,
  };
};

const callReport = async (context, options) => {
  const req = {
    tenant: getReadyTenant(context),
    params: {
      ledgerCode: options.ledgerCode,
    },
    query: {
      startDate: options.startDate,
      endDate: options.endDate,
      page: options.page?.toString(),
      limit: options.limit?.toString(),
    },
  };

  let payload;
  let status;

  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };

  const next = (error) => {
    throw error;
  };

  await getLedgerTransactions(req, res, next);

  assert.equal(status, 200);
  assert.equal(payload.success, true);

  return payload;
};

const verifyCashReport = async (context, fixtures, dates) => {
  const before = await snapshotTenant(context);

  const report = await callReport(context, {
    ledgerCode: "CASH",
    startDate: dates.today,
    endDate: dates.today,
    page: 1,
    limit: 1,
  });

  assert.equal(report.data.ledger.code, "CASH");

  assert.equal(
    report.data.openingBalance,
    10100,
    "Opening balance must include prior-period receipt",
  );

  assert.equal(report.data.openingBalanceType, "DEBIT");

  assert.equal(report.data.totals.debit, 0);
  assert.equal(report.data.totals.credit, 100);

  assert.equal(report.data.closingBalance, 10000);
  assert.equal(report.data.closingBalanceType, "DEBIT");

  assert.equal(report.pagination.total, 1);
  assert.equal(report.transactions.length, 1);
  assert.equal(report.data.pageOpeningBalance, 10100);

  const transaction = report.transactions[0];

  assert.equal(transaction.credit, 100);
  assert.equal(transaction.debit, 0);
  assert.equal(transaction.balance, 10000);
  assert.equal(transaction.balanceType, "DEBIT");

  assert.equal(
    transaction.sourceType,
    "SUPPLIER_PAYMENT",
  );

  assert.ok(
    mongoose.isObjectIdOrHexString(
      transaction.sourceId,
    ),
    "Supplier Payment Journal sourceId must be a valid ObjectId",
  );

  assert.notEqual(
    transaction.sourceId.toString(),
    fixtures.currentBill._id.toString(),
    "Supplier Payment Journal sourceId must reference the payment, not the bill",
  );

  assert.ok(transaction.journalNumber);

  const pageTwo = await callReport(context, {
    ledgerCode: "CASH",
    startDate: dates.today,
    endDate: dates.today,
    page: 2,
    limit: 1,
  });

  assert.equal(pageTwo.pagination.total, 1);
  assert.equal(pageTwo.transactions.length, 0);
  assert.equal(pageTwo.data.pageOpeningBalance, 10000);
  assert.equal(pageTwo.data.closingBalance, 10000);

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Ledger transaction report changed tenant data",
  );

  console.log(
    "PASS: CASH report included prior-period movement, current-period totals, page-opening balance, and draft exclusion",
  );
};

const verifyBankReport = async (context, fixtures, dates) => {
  const before = await snapshotTenant(context);

  const report = await callReport(context, {
    ledgerCode: fixtures.bankCode,
    startDate: dates.today,
    endDate: dates.today,
  });

  assert.equal(
    String(report.data.ledger._id),
    String(fixtures.bankLedger._id),
  );

  assert.equal(report.data.ledger.code, fixtures.bankCode);

  assert.equal(report.data.openingBalance, 5000);
  assert.equal(report.data.openingBalanceType, "DEBIT");

  assert.equal(report.data.totals.debit, 200);
  assert.equal(report.data.totals.credit, 0);

  assert.equal(report.data.closingBalance, 5200);
  assert.equal(report.data.closingBalanceType, "DEBIT");

  assert.equal(report.pagination.total, 1);

  const transaction = report.transactions[0];

  assert.equal(transaction.debit, 200);
  assert.equal(transaction.credit, 0);
  assert.equal(transaction.balance, 5200);
  assert.equal(transaction.balanceType, "DEBIT");

  assert.equal(transaction.sourceType, "CUSTOMER_RECEIPT");

  assert.ok(
    mongoose.isObjectIdOrHexString(
      transaction.sourceId,
    ),
    "Customer Receipt Journal sourceId must be a valid ObjectId",
  );

  assert.notEqual(
    transaction.sourceId.toString(),
    fixtures.currentInvoice._id.toString(),
    "Customer Receipt Journal sourceId must reference the receipt, not the invoice",
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Bank transaction report changed tenant data",
  );

  console.log(
    "PASS: Bank-code lookup resolved its linked Ledger and included the Bank receipt",
  );
};

const verifyInactiveLedgerHistory = async (
  context,
  fixtures,
  dates,
) => {
  const before = await snapshotTenant(context);

  fixtures.cash.isActive = false;

  await fixtures.cash.save();

  const report = await callReport(context, {
    ledgerCode: "CASH",
    startDate: dates.today,
    endDate: dates.today,
  });

  assert.equal(report.data.ledger.code, "CASH");
  assert.equal(report.pagination.total, 1);
  assert.equal(report.data.closingBalance, 10000);

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Inactive Ledger report changed tenant data",
  );

  console.log(
    "PASS: inactive Ledger retained historical transaction visibility",
  );
};

const verifyValidation = async (context, dates) => {
  const invalidDates = [
    {
      startDate: "2026-13-01",
      endDate: dates.today,
      message: "startDate must use YYYY-MM-DD format",
    },
    {
      startDate: dates.today,
      endDate: "2026-02-30",
      message: "endDate is invalid",
    },
    {
      startDate: dates.today,
      endDate: dates.priorDay,
      message: "startDate cannot be after endDate",
    },
  ];

  for (const item of invalidDates) {
    await assert.rejects(
      () =>
        callReport(context, {
          ledgerCode: "CASH",
          startDate: item.startDate,
          endDate: item.endDate,
        }),
      (error) => error.message === item.message,
    );
  }

  await assert.rejects(
    () =>
      callReport(context, {
        ledgerCode: "NO_SUCH_LEDGER",
        startDate: dates.today,
        endDate: dates.today,
      }),
    (error) => error.message === "Accounting ledger not found",
  );

  await assert.rejects(
    () =>
      callReport(context, {
        ledgerCode: "CASH",
        startDate: dates.today,
        endDate: dates.today,
        page: "0",
      }),
    (error) =>
      error.message ===
      "page must be between 1 and 9007199254740991",
  );

  console.log(
    "PASS: invalid dates, unknown Ledgers, and invalid pagination rejected",
  );
};

const verifyCrossTenantFilters = async (
  contextA,
  fixturesA,
  contextB,
  fixturesB,
  dates,
) => {
  const foreignLedgerId =
    fixturesA.bankLedger._id.toString();

  const report = await callReport(contextB, {
    ledgerCode: fixturesB.bankCode,
    startDate: dates.today,
    endDate: dates.today,
  });

  assert.notEqual(
    String(report.data.ledger._id),
    foreignLedgerId,
  );

  assert.equal(report.data.openingBalance, 5000);
  assert.equal(report.data.totals.debit, 200);
  assert.equal(report.data.closingBalance, 5200);

  console.log(
    "PASS: each tenant resolved its own generated Bank code and Ledger independently",
  );
};

const verifyMainDatabase = async () => {
  const tenantIds = contexts.map((context) => context.tenantId);

  const collectionNames = new Set();

  for (const context of contexts) {
    for (const name of MODEL_NAMES) {
      collectionNames.add(context.models[name].collection.name);
    }
  }

  for (const name of collectionNames) {
    assert.equal(
      await mongoose.connection.db
        .collection(name)
        .countDocuments({
          tenantId: { $in: tenantIds },
        }),
      0,
      `Test records found in main collection: ${name}`,
    );
  }

  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  if (collections.some((item) => item.name === "counters")) {
    const counterIds = contexts.flatMap((context) =>
      [
        "CU",
        "SU",
        "PR",
        "SI",
        "PB",
        "CR",
        "SP",
        "JV",
        "BK",
      ].map(
        (prefix) => `${context.tenantId}_${prefix}`,
      ),
    );

    assert.equal(
      await mongoose.connection.db
        .collection("counters")
        .countDocuments({
          _id: { $in: counterIds },
        }),
      0,
      "Test counters leaked into main database",
    );
  }

  console.log(
    "PASS: no matching test records or counters found in main database",
  );
};

const run = async () => {
  const { uri, expectedMainDb } = validateConfiguration();

  process.env.TENANT_DATABASES_ENABLED = "true";

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });

  assert.equal(
    mongoose.connection.name,
    expectedMainDb,
    "Connected database does not match expected test database",
  );

  console.log(
    "Connected test main database:",
    mongoose.connection.name,
  );

  const originalCreate = NotificationService.create;
  const originalCreateForTenant = NotificationService.createForTenant;

  assert.equal(typeof originalCreate, "function");
  assert.equal(typeof originalCreateForTenant, "function");

  NotificationService.create = async () => null;
  NotificationService.createForTenant = async () => null;

  try {
    const dates = makeDates();

    const contextA = createTenantContext("Tenant A");
    const contextB = createTenantContext("Tenant B");

    await provisionTenant(contextA);
    await provisionTenant(contextB);

    const fixturesA = await createFixtures(contextA, dates);
    const fixturesB = await createFixtures(contextB, dates);

    await verifyCashReport(contextA, fixturesA, dates);
    await verifyCashReport(contextB, fixturesB, dates);

    await verifyBankReport(contextA, fixturesA, dates);
    await verifyBankReport(contextB, fixturesB, dates);

    await verifyInactiveLedgerHistory(
      contextA,
      fixturesA,
      dates,
    );

    await verifyValidation(contextA, dates);

    await verifyCrossTenantFilters(
      contextA,
      fixturesA,
      contextB,
      fixturesB,
      dates,
    );

    await verifyMainDatabase();

    console.log("Tenant Ledger Transactions test PASSED");
    console.log("Notifications were stubbed; no notifications were sent.");
    console.log("No Tenant record was saved or marked READY.");
    console.log("No API routing was changed.");
  } finally {
    NotificationService.create = originalCreate;
    NotificationService.createForTenant = originalCreateForTenant;
  }
};

run()
  .catch((error) => {
    console.error(
      "Tenant Ledger Transactions test FAILED:",
      error.stack || error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    const failed = process.exitCode === 1;

    if (failed && createdDatabases.length) {
      console.log(
        "Test failed; tenant databases retained for inspection:",
      );

      for (const name of createdDatabases) {
        console.log(`- ${name}`);
      }
    }

    if (!failed) {
      for (const context of contexts) {
        try {
          await context.connection.dropDatabase();

          console.log(
            `Dropped passed-test database: ${context.databaseName}`,
          );
        } catch (error) {
          console.error(
            `Could not drop ${context.databaseName}:`,
            error.message,
          );

          process.exitCode = 1;
        }
      }
    }

    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error.message);
      process.exitCode = 1;
    }
  });