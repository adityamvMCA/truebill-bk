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

const productService = require(
  "../src/modules/products/product.service",
);

const salesInvoiceService = require(
  "../src/modules/sales-invoices/salesInvoice.service",
);

const customerReceiptService = require(
  "../src/modules/customer-receipts/customerReceipt.service",
);

const NotificationService = require(
  "../src/services/notificationService",
);

const contexts = [];
const createdDatabases = [];
const notificationCalls = [];

const MODEL_NAMES = [
  "LedgerGroup",
  "Ledger",
  "Customer",
  "Product",
  "SalesInvoice",
  "CustomerReceipt",
  "Journal",
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
    businessName: `Customer Receipt Test ${label}`,
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
    databaseName,
    models,
    tenantId,
  } = context;

  assert.notEqual(
    databaseName,
    mongoose.connection.name,
    "Tenant database must not be the main database",
  );

  assert.equal(
    connection.name,
    databaseName,
    "Tenant connection has the wrong database name",
  );

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

  assert.ok(
    models.Customer.schema.path("receivableBalance"),
    "Customer schema must include receivableBalance",
  );

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

const assertCounter = async (context, prefix, expected) => {
  const counter = await context.connection.db
    .collection("counters")
    .findOne({
      _id: `${context.tenantId}_${prefix}`,
    });

  assert.ok(counter, `Tenant-local ${prefix} counter is missing`);

  assert.equal(
    counter.seq,
    expected,
    `Unexpected ${prefix} counter value`,
  );
};

const snapshotTenant = async (context) => {
  const snapshot = {};

  for (const name of MODEL_NAMES) {
    let query = context.models[name].find({});

    if (name === "CustomerReceipt") {
      query = query.select("+requestHash");
    }

    const documents = await query
      .sort({ _id: 1 })
      .lean();

    snapshot[name] = JSON.stringify(documents);
  }

  const counters = await context.connection.db
    .collection("counters")
    .find({})
    .sort({ _id: 1 })
    .toArray();

  snapshot.counters = JSON.stringify(counters);

  return snapshot;
};

const createFixtures = async (context) => {
  const customer = await customerService.createCustomer({
    ...requestContext(context),
    payload: {
      customerName: `${context.label} Receipt Customer`,
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

  const product = await productService.createProduct({
    ...requestContext(context),
    payload: {
      name: `${context.label} Receipt Test Product`,
      type: "GOODS",
      unit: "NOS",
      gstRate: 18,
      salePrice: 100,
      purchasePrice: 60,
      trackInventory: true,
      openingStock: 30,
      openingStockRate: 60,
      reorderLevel: 2,
      status: "ACTIVE",
    },
  });

  const invoiceDate = new Date().toISOString().slice(0, 10);

  const dueDate = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const invoices = [];

  for (const quantity of [10, 5]) {
    const invoice = await salesInvoiceService.createSalesInvoice({
      ...requestContext(context),
      payload: {
        action: "SAVE_AND_POST",
        customerId: customer._id.toString(),
        invoiceDate,
        dueDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRA_STATE",
        updateStock: true,
        items: [
          {
            productId: product._id.toString(),
            quantity,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
          },
        ],
      },
    });

    assert.equal(invoice.status, "POSTED");

    invoices.push(invoice);
  }

  assert.equal(invoices[0].totalAmountPaise, 118000);
  assert.equal(invoices[1].totalAmountPaise, 59000);

  const cashLedger = await context.models.Ledger.findOne({
    tenantId: context.tenantId,
    code: "CASH",
    type: "CASH",
    nature: "ASSET",
    isActive: true,
  }).lean();

  assert.ok(cashLedger, "Seeded CASH Ledger is missing");

  const bankGroup = await context.models.LedgerGroup.findOne({
    tenantId: context.tenantId,
    code: "BANK_ACCOUNTS",
    isActive: true,
  }).lean();

  assert.ok(bankGroup, "BANK_ACCOUNTS group is missing");

  const bankLedger = await context.models.Ledger.create({
    tenantId: context.tenantId,
    ledgerGroupId: bankGroup._id,
    code: "TEST_RECEIPT_BANK",
    name: "Test Receipt Bank",
    type: "BANK",
    nature: "ASSET",
    normalBalance: "DEBIT",
    openingBalance: 0,
    openingBalanceType: "DEBIT",
    currentBalance: 0,
    currentBalanceType: "DEBIT",
    referenceType: "BANK",
    referenceId: new mongoose.Types.ObjectId(),
    isSystem: false,
    isActive: true,
    createdBy: context.userId,
    updatedBy: context.userId,
  });

  const savedCustomer = await context.models.Customer
    .findById(customer._id)
    .lean();

  assert.equal(savedCustomer.receivableBalance, 1770);

  await assertCounter(context, "CU", 1);
  await assertCounter(context, "PR", 1);
  await assertCounter(context, "SI", 2);
  await assertCounter(context, "JV", 2);

  console.log(
    `PASS: ${context.label} Customer, Product, two posted invoices, and receipt Ledger fixtures created`,
  );

  return {
    customer,
    product,
    invoices,
    cashLedger,
    bankLedger,
  };
};

const receiptPayload = (
  fixtures,
  {
    requestId = randomUUID(),
    receiptLedgerId = fixtures.cashLedger._id,
    receiptMethod = "CASH",
    amount = 500,
    allocations = [
      {
        salesInvoiceId: fixtures.invoices[0]._id.toString(),
        amount: 500,
      },
    ],
  } = {},
) => ({
  requestId,
  customerId: fixtures.customer._id.toString(),
  receiptLedgerId: receiptLedgerId.toString(),
  receiptDate: new Date().toISOString().slice(0, 10),
  receiptMethod,
  referenceNumber: "RECEIPT-TEST",
  amount,
  allocations,
  notes: "Tenant Customer Receipt integration test",
});

const assertCustomerBalance = async (context, fixtures, expected) => {
  const customer = await context.models.Customer
    .findById(fixtures.customer._id)
    .lean();

  const ledger = await context.models.Ledger
    .findById(fixtures.customer.ledgerId)
    .lean();

  assert.ok(customer);
  assert.ok(ledger);

  assert.equal(customer.receivableBalance, expected);
  assert.equal(ledger.currentBalance, expected);
  assert.equal(ledger.currentBalanceType, "DEBIT");
};

const verifyPartialReceipt = async (context, fixtures) => {
  const payload = receiptPayload(fixtures);

  const notificationsBefore = notificationCalls.length;

  const result = await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload,
  });

  assert.equal(result.replayed, false);

  const receipt = result.receipt;

  assert.equal(receipt.receiptNumber, "CR001");
  assert.equal(receipt.status, "POSTED");
  assert.equal(receipt.amountPaise, 50000);
  assert.equal(receipt.receiptLedgerType, "CASH");
  assert.equal(receipt.allocations.length, 1);
  assert.equal(receipt.allocations[0].amountPaise, 50000);
  assert.equal(receipt.requestHash, undefined);

  const stored = await context.models.CustomerReceipt
    .findById(receipt._id)
    .select("+requestHash")
    .lean();

  assert.ok(stored);
  assert.match(stored.requestHash, /^[0-9a-f]{64}$/);

  const journal = await context.models.Journal
    .findById(receipt.journalId)
    .lean();

  assert.ok(journal);
  assert.equal(journal.sourceType, "CUSTOMER_RECEIPT");
  assert.equal(String(journal.sourceId), String(receipt._id));
  assert.equal(journal.totalDebitPaise, 50000);
  assert.equal(journal.totalCreditPaise, 50000);

  const cashLine = journal.lines.find(
    (line) => String(line.ledgerId) === String(fixtures.cashLedger._id),
  );

  const customerLine = journal.lines.find(
    (line) =>
      String(line.ledgerId) === String(fixtures.customer.ledgerId),
  );

  assert.ok(cashLine);
  assert.ok(customerLine);

  assert.equal(cashLine.debitPaise, 50000);
  assert.equal(cashLine.creditPaise, 0);
  assert.equal(customerLine.debitPaise, 0);
  assert.equal(customerLine.creditPaise, 50000);

  const invoice = await context.models.SalesInvoice
    .findById(fixtures.invoices[0]._id)
    .lean();

  assert.equal(invoice.paidAmountPaise, 50000);
  assert.equal(invoice.outstandingAmountPaise, 68000);
  assert.equal(invoice.paymentStatus, "PARTIALLY_PAID");

  await assertCustomerBalance(context, fixtures, 1270);

  const cashLedger = await context.models.Ledger
    .findById(fixtures.cashLedger._id)
    .lean();

  assert.equal(cashLedger.currentBalance, 500);
  assert.equal(cashLedger.currentBalanceType, "DEBIT");

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "CUSTOMER_RECEIPT",
    action: "CREATE",
    documentId: receipt._id,
  }).lean();

  assert.ok(audit);

  await assertCounter(context, "CR", 1);
  await assertCounter(context, "JV", 3);

  assert.equal(notificationCalls.length, notificationsBefore + 1);

  assert.equal(
    notificationCalls[notificationsBefore].type,
    "CUSTOMER_RECEIPT",
  );

  console.log(
    "PASS: partial CASH receipt, Journal, invoice allocation, receivable, audit, and CR/JV counters verified",
  );

  return { payload, receipt };
};

const verifyReplay = async (context, partial) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  const replay = await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload: partial.payload,
  });

  assert.equal(replay.replayed, true);

  assert.equal(
    String(replay.receipt._id),
    String(partial.receipt._id),
  );

  assert.equal(replay.receipt.requestHash, undefined);

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Idempotent replay changed tenant data",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  await assert.rejects(
    () => customerReceiptService.createCustomerReceipt({
      ...requestContext(context),
      payload: {
        ...partial.payload,
        notes: "Different payload using the same requestId",
      },
    }),
    (error) =>
      error.statusCode === 409 &&
      /already used for a different receipt/i.test(error.message),
  );

  assert.deepEqual(await snapshotTenant(context), before);

  console.log(
    "PASS: identical request replayed without writes; changed payload with reused requestId rejected",
  );
};

const verifyOverAllocation = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  await assert.rejects(
    () => customerReceiptService.createCustomerReceipt({
      ...requestContext(context),
      payload: receiptPayload(fixtures, {
        amount: 700,
        allocations: [
          {
            salesInvoiceId: fixtures.invoices[0]._id.toString(),
            amount: 700,
          },
        ],
      }),
    }),
    (error) =>
      error.statusCode === 409 &&
      /Allocation exceeds/i.test(error.message),
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Over-allocation rejection changed tenant data",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  console.log("PASS: invoice over-allocation rejected without writes");
};

const verifyLateRollback = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  const AuditLog = context.models.AuditLog;
  const originalCreate = AuditLog.create;

  const message = "Intentional Customer Receipt audit failure";

  let failureReached = false;

  AuditLog.create = async function (...args) {
    const result = await originalCreate.apply(this, args);

    const documents = Array.isArray(args[0])
      ? args[0]
      : [args[0]];

    if (
      documents.some(
        (document) =>
          document?.module === "CUSTOMER_RECEIPT" &&
          document.action === "CREATE",
      )
    ) {
      failureReached = true;

      throw new Error(message);
    }

    return result;
  };

  try {
    await assert.rejects(
      () => customerReceiptService.createCustomerReceipt({
        ...requestContext(context),
        payload: receiptPayload(fixtures, {
          amount: 100,
          allocations: [
            {
              salesInvoiceId: fixtures.invoices[0]._id.toString(),
              amount: 100,
            },
          ],
        }),
      }),
      (error) => error.message === message,
    );
  } finally {
    AuditLog.create = originalCreate;
  }

  assert.equal(failureReached, true);

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Late receipt failure did not fully roll back",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  console.log(
    "PASS: late failure rolled back receipt, Journal, Ledgers, invoice allocations, Customer, audits, and CR/JV counters",
  );
};

const verifyFullSettlement = async (context, fixtures) => {
  const result = await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload: receiptPayload(fixtures, {
      receiptLedgerId: fixtures.bankLedger._id,
      receiptMethod: "BANK_TRANSFER",
      amount: 1270,
      allocations: [
        {
          salesInvoiceId: fixtures.invoices[0]._id.toString(),
          amount: 680,
        },
        {
          salesInvoiceId: fixtures.invoices[1]._id.toString(),
          amount: 590,
        },
      ],
    }),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.receipt.receiptNumber, "CR002");
  assert.equal(result.receipt.receiptLedgerType, "BANK");
  assert.equal(result.receipt.amountPaise, 127000);
  assert.equal(result.receipt.allocations.length, 2);

  for (const original of fixtures.invoices) {
    const invoice = await context.models.SalesInvoice
      .findById(original._id)
      .lean();

    assert.equal(invoice.paymentStatus, "PAID");
    assert.equal(invoice.outstandingAmountPaise, 0);
    assert.equal(invoice.paidAmountPaise, invoice.totalAmountPaise);
  }

  await assertCustomerBalance(context, fixtures, 0);

  const bankLedger = await context.models.Ledger
    .findById(fixtures.bankLedger._id)
    .lean();

  assert.equal(bankLedger.currentBalance, 1270);
  assert.equal(bankLedger.currentBalanceType, "DEBIT");

  const journal = await context.models.Journal
    .findById(result.receipt.journalId)
    .lean();

  assert.ok(journal);
  assert.equal(journal.totalDebitPaise, 127000);
  assert.equal(journal.totalCreditPaise, 127000);

  const unpaid = await customerReceiptService.getUnpaidSalesInvoices({
    tenant: getReadyTenant(context),
    customerId: fixtures.customer._id.toString(),
  });

  assert.equal(unpaid.pagination.total, 0);
  assert.equal(unpaid.data.length, 0);

  await assertCounter(context, "CR", 2);
  await assertCounter(context, "JV", 4);

  console.log(
    "PASS: BANK receipt settled two invoices, updated Bank balance, and reduced Customer receivable to zero",
  );
};

const verifyReadEndpoints = async (context, fixtures, partial) => {
  const tenant = getReadyTenant(context);

  const receipt = await customerReceiptService
    .getCustomerReceiptByNumber({
      tenant,
      receiptNumber: "cr001",
    });

  assert.equal(String(receipt._id), String(partial.receipt._id));
  assert.equal(receipt.requestHash, undefined);

  const listing = await customerReceiptService.getCustomerReceipts({
    tenant,
    customerId: fixtures.customer._id.toString(),
    page: 1,
    limit: 20,
  });

  assert.equal(listing.pagination.total, 2);
  assert.equal(listing.data.length, 2);

  for (const item of listing.data) {
    assert.equal(item.requestHash, undefined);
    assert.equal(item.allocations, undefined);
  }

  const ledgers = await customerReceiptService.getReceiptLedgers({
    tenant,
  });

  assert.ok(
    ledgers.some(
      (ledger) =>
        String(ledger._id) === String(fixtures.cashLedger._id),
    ),
  );

  assert.ok(
    ledgers.some(
      (ledger) =>
        String(ledger._id) === String(fixtures.bankLedger._id),
    ),
  );

  console.log(
    "PASS: receipt lookup, listing, unpaid-invoice lookup, and receipt Ledger listing verified",
  );
};

const verifyTenantBReceipt = async (
  context,
  fixtures,
  sharedRequestId,
) => {
  const result = await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload: receiptPayload(fixtures, {
      requestId: sharedRequestId,
    }),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.receipt.receiptNumber, "CR001");

  await assertCounter(context, "CR", 1);
  await assertCounter(context, "JV", 3);

  await assertCustomerBalance(context, fixtures, 1270);

  console.log(
    "PASS: Tenant B independently created CR001 using the same requestId without replaying Tenant A",
  );
};

const verifyCrossTenantAllocation = async (
  contextA,
  fixturesA,
  contextB,
  fixturesB,
) => {
  const beforeA = await snapshotTenant(contextA);
  const beforeB = await snapshotTenant(contextB);

  await assert.rejects(
    () => customerReceiptService.createCustomerReceipt({
      ...requestContext(contextB),
      payload: receiptPayload(fixturesB, {
        amount: 100,
        allocations: [
          {
            salesInvoiceId: fixturesA.invoices[0]._id.toString(),
            amount: 100,
          },
        ],
      }),
    }),
    (error) =>
      error.statusCode === 409 &&
      /selected invoices are unavailable/i.test(error.message),
  );

  assert.deepEqual(await snapshotTenant(contextA), beforeA);
  assert.deepEqual(await snapshotTenant(contextB), beforeB);

  console.log(
    "PASS: cross-tenant invoice allocation rejected without changing either tenant",
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

  const mainCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  if (mainCollections.some((item) => item.name === "counters")) {
    const counterIds = contexts.flatMap((context) =>
      ["CU", "PR", "SI", "CR", "JV"].map(
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
    "PASS: no matching test records or CU/PR/SI/CR/JV counters found in main database",
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

  const originalNotification = NotificationService.create;

  assert.equal(
    typeof originalNotification,
    "function",
    "NotificationService.create is missing",
  );

  NotificationService.create = async (payload) => {
    notificationCalls.push(payload);

    return null;
  };

  try {
    const contextA = createTenantContext("Tenant A");
    const contextB = createTenantContext("Tenant B");

    await provisionTenant(contextA);
    await provisionTenant(contextB);

    const fixturesA = await createFixtures(contextA);
    const fixturesB = await createFixtures(contextB);

    const tenantBBefore = await snapshotTenant(contextB);

    const partial = await verifyPartialReceipt(contextA, fixturesA);

    await verifyReplay(contextA, partial);
    await verifyOverAllocation(contextA, fixturesA);
    await verifyLateRollback(contextA, fixturesA);
    await verifyFullSettlement(contextA, fixturesA);
    await verifyReadEndpoints(contextA, fixturesA, partial);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBBefore,
      "Tenant B changed during Tenant A receipt operations",
    );

    console.log(
      "PASS: Tenant B remained unchanged during Tenant A receipt operations",
    );

    const tenantACompleted = await snapshotTenant(contextA);

    await verifyTenantBReceipt(
      contextB,
      fixturesB,
      partial.payload.requestId,
    );

    assert.deepEqual(
      await snapshotTenant(contextA),
      tenantACompleted,
      "Tenant A changed during Tenant B receipt operations",
    );

    await verifyCrossTenantAllocation(
      contextA,
      fixturesA,
      contextB,
      fixturesB,
    );

    await verifyMainDatabase();

    console.log("Tenant Customer Receipt test PASSED");
    console.log("Notifications were stubbed; no notifications were sent.");
    console.log("No Tenant record was saved or marked READY.");
    console.log("No API routing was changed.");
  } finally {
    NotificationService.create = originalNotification;
  }
};

run()
  .catch((error) => {
    console.error(
      "Tenant Customer Receipt test FAILED:",
      error.stack || error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdDatabases.length) {
      console.log("Test databases retained for inspection:");

      for (const name of createdDatabases) {
        console.log(`- ${name}`);
      }
    }

    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error.message);

      process.exitCode = 1;
    }
  });