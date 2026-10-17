const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
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
    businessName: `Sales Invoice Test ${label}`,
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
    tenantId,
    connection,
    models,
    databaseName,
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
    "Add receivableBalance to customer.model.js before running this test",
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
        userId: null,
        models,
        session,
      });

      await seedDefaultLedgers({
        tenantId,
        userId: null,
        models,
        session,
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

  for (const code of [
    "OUTPUT_CGST",
    "OUTPUT_SGST",
    "OUTPUT_IGST",
  ]) {
    const ledger = await models.Ledger.findOne({
      tenantId,
      code,
      type: "TAX",
      nature: "LIABILITY",
      isActive: true,
    }).lean();

    assert.ok(ledger, `Seeded output-tax Ledger is missing: ${code}`);
  }

  console.log(`${context.label} provisioned: ${databaseName}`);
};

const getCounter = async (context, prefix) => {
  return context.connection.db
    .collection("counters")
    .findOne({
      _id: `${context.tenantId}_${prefix}`,
    });
};

const assertCounter = async (context, prefix, expected) => {
  const counter = await getCounter(context, prefix);

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
    const documents = await context.models[name]
      .find({})
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
      customerName: `${context.label} Customer`,
      customerType: "Business",
      paymentTerms: "Due on Receipt",
      creditLimit: 100000,
      creditDays: 30,
      openingBalance: 0,
      openingBalanceType: "DEBIT",
      status: "Active",
      country: "India",
      priceList: "Standard",
    },
  });

  assert.equal(customer.customerCode, "CU001");
  assert.ok(customer.ledgerId);

  const savedCustomer = await context.models.Customer
    .findById(customer._id)
    .lean();

  assert.equal(savedCustomer.receivableBalance, 0);

  const product = await productService.createProduct({
    ...requestContext(context),
    payload: {
      name: `${context.label} Inventory Product`,
      type: "GOODS",
      unit: "NOS",
      gstRate: 18,
      salePrice: 100,
      purchasePrice: 60,
      trackInventory: true,
      openingStock: 20,
      openingStockRate: 60,
      reorderLevel: 2,
      status: "ACTIVE",
    },
  });

  assert.equal(product.productCode, "PR001");
  assert.equal(product.currentStock, 20);

  await assertCounter(context, "CU", 1);
  await assertCounter(context, "PR", 1);

  console.log(
    `PASS: ${context.label} Customer and inventory Product created through real services`,
  );

  return { customer, product };
};

const invoicePayload = (
  fixtures,
  {
    action = "SAVE_AND_POST",
    quantity = 10,
    taxMode = "INTRA_STATE",
    gstRate = 18,
  } = {},
) => {
  const invoiceDate = new Date();

  const dueDate = new Date(invoiceDate.getTime() + 7 * 86400000);

  return {
    action,
    customerId: fixtures.customer._id.toString(),
    invoiceDate: invoiceDate.toISOString().slice(0, 10),
    dueDate: dueDate.toISOString().slice(0, 10),
    paymentTerms: "Due on Receipt",
    taxMode,
    updateStock: true,
    items: [
      {
        productId: fixtures.product._id.toString(),
        quantity,
        unitRate: 100,
        discountPercent: 0,
        gstRate,
      },
    ],
    notes: "Tenant Sales Invoice integration test",
  };
};

const verifyFirstPosting = async (context, fixtures) => {
  const invoice = await salesInvoiceService.createSalesInvoice({
    ...requestContext(context),
    payload: invoicePayload(fixtures),
  });

  assert.equal(invoice.invoiceNumber, "SI001");
  assert.equal(invoice.status, "POSTED");
  assert.ok(invoice.journalId);
  assert.ok(invoice.postedAt);
  assert.equal(invoice.taxableAmountPaise, 100000);
  assert.equal(invoice.cgstAmountPaise, 9000);
  assert.equal(invoice.sgstAmountPaise, 9000);
  assert.equal(invoice.igstAmountPaise, 0);
  assert.equal(invoice.totalAmountPaise, 118000);
  assert.equal(invoice.outstandingAmountPaise, 118000);

  const journal = await context.models.Journal
    .findById(invoice.journalId)
    .lean();

  assert.ok(journal);
  assert.equal(journal.sourceType, "SALES_INVOICE");
  assert.equal(String(journal.sourceId), String(invoice._id));
  assert.equal(journal.totalDebitPaise, 118000);
  assert.equal(journal.totalCreditPaise, 118000);

  const expectedLines = {
    SALES: { debitPaise: 0, creditPaise: 100000 },
    OUTPUT_CGST: { debitPaise: 0, creditPaise: 9000 },
    OUTPUT_SGST: { debitPaise: 0, creditPaise: 9000 },
  };

  for (const [code, expected] of Object.entries(expectedLines)) {
    const line = journal.lines.find((item) => item.ledgerCode === code);

    assert.ok(line, `Journal line is missing: ${code}`);
    assert.equal(line.debitPaise, expected.debitPaise);
    assert.equal(line.creditPaise, expected.creditPaise);
  }

  const customerLine = journal.lines.find(
    (line) =>
      String(line.ledgerId) === String(fixtures.customer.ledgerId),
  );

  assert.ok(customerLine);
  assert.equal(customerLine.debitPaise, 118000);
  assert.equal(customerLine.creditPaise, 0);

  for (const [code, amount] of [
    ["SALES", 1000],
    ["OUTPUT_CGST", 90],
    ["OUTPUT_SGST", 90],
  ]) {
    const ledger = await context.models.Ledger.findOne({
      tenantId: context.tenantId,
      code,
    }).lean();

    assert.ok(ledger);
    assert.equal(ledger.currentBalance, amount);
    assert.equal(ledger.currentBalanceType, "CREDIT");
  }

  const customerLedger = await context.models.Ledger
    .findById(fixtures.customer.ledgerId)
    .lean();

  assert.equal(customerLedger.currentBalance, 1180);
  assert.equal(customerLedger.currentBalanceType, "DEBIT");

  const customer = await context.models.Customer
    .findById(fixtures.customer._id)
    .lean();

  assert.equal(customer.receivableBalance, 1180);

  const movements = await context.models.StockMovement.find({
    tenantId: context.tenantId,
    referenceType: "SALES_INVOICE",
    referenceId: invoice._id,
  }).lean();

  assert.equal(movements.length, 1);
  assert.equal(movements[0].movementType, "SALE");
  assert.equal(movements[0].direction, "OUT");
  assert.equal(movements[0].quantity, 10);
  assert.equal(movements[0].stockBefore, 20);
  assert.equal(movements[0].stockAfter, 10);

  const product = await context.models.Product
    .findById(fixtures.product._id)
    .lean();

  assert.equal(product.currentStock, 10);

  for (const action of ["CREATE", "POST"]) {
    const audit = await context.models.AuditLog.findOne({
      tenantId: context.tenantId,
      module: "SALES_INVOICE",
      documentId: invoice._id,
      action,
    }).lean();

    assert.ok(audit, `${action} Sales Invoice audit is missing`);
  }

  await assertCounter(context, "SI", 1);
  await assertCounter(context, "JV", 1);

  const fetched = await salesInvoiceService.getSalesInvoiceByNumber({
    tenant: getReadyTenant(context),
    invoiceNumber: "si001",
  });

  assert.equal(String(fetched._id), String(invoice._id));

  const listing = await salesInvoiceService.getSalesInvoices({
    tenant: getReadyTenant(context),
    status: "POSTED",
    customerId: fixtures.customer._id.toString(),
    page: 1,
    limit: 20,
  });

  assert.equal(listing.pagination.total, 1);
  assert.equal(listing.data.length, 1);

  console.log(
    "PASS: posted invoice, balanced Journal, Sales/GST Ledgers, receivable, SALE stock, audits, and SI/JV counters verified",
  );

  return invoice;
};

const verifyInsufficientStock = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  await assert.rejects(
    () => salesInvoiceService.createSalesInvoice({
      ...requestContext(context),
      payload: invoicePayload(fixtures, { quantity: 11 }),
    }),
    (error) =>
      error.statusCode === 409 &&
      /Insufficient stock/i.test(error.message),
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Insufficient-stock failure did not fully roll back",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  console.log(
    "PASS: insufficient stock rejected and invoice, Journal, Ledgers, receivable, audits, and counters rolled back",
  );
};

const verifyLateFailureRollback = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  const AuditLog = context.models.AuditLog;
  const originalCreate = AuditLog.create;

  const failureMessage = "Intentional Sales Invoice POST audit failure";

  let failureReached = false;

  AuditLog.create = async function (...args) {
    const result = await originalCreate.apply(this, args);

    const documents = Array.isArray(args[0])
      ? args[0]
      : [args[0]];

    if (
      documents.some(
        (document) =>
          document?.module === "SALES_INVOICE" &&
          document.action === "POST",
      )
    ) {
      failureReached = true;

      throw new Error(failureMessage);
    }

    return result;
  };

  try {
    await assert.rejects(
      () => salesInvoiceService.createSalesInvoice({
        ...requestContext(context),
        payload: invoicePayload(fixtures, { quantity: 1 }),
      }),
      (error) => error.message === failureMessage,
    );
  } finally {
    AuditLog.create = originalCreate;
  }

  assert.equal(failureReached, true);

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Late posting failure did not fully roll back",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  console.log(
    "PASS: late POST failure rolled back invoice, Journal, Ledgers, Customer, stock, audits, and SI/JV counters",
  );
};

const verifyDraftWorkflow = async (context, fixtures) => {
  const draft = await salesInvoiceService.createSalesInvoice({
    ...requestContext(context),
    payload: invoicePayload(fixtures, {
      action: "SAVE_DRAFT",
      quantity: 1,
    }),
  });

  assert.equal(draft.invoiceNumber, "SI002");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.journalId, null);

  await assertCounter(context, "SI", 2);
  await assertCounter(context, "JV", 1);

  assert.equal(
    await context.models.StockMovement.countDocuments({
      referenceType: "SALES_INVOICE",
      referenceId: draft._id,
    }),
    0,
  );

  const replacement = invoicePayload(fixtures, {
    quantity: 2,
    taxMode: "INTER_STATE",
  });

  delete replacement.action;

  const updated = await salesInvoiceService.updateSalesInvoice({
    ...requestContext(context),
    invoiceNumber: draft.invoiceNumber,
    payload: replacement,
  });

  assert.equal(updated.status, "DRAFT");
  assert.equal(updated.items[0].quantity, 2);
  assert.equal(updated.taxMode, "INTER_STATE");
  assert.equal(updated.totalAmountPaise, 23600);

  const posted = await salesInvoiceService.postSalesInvoice({
    ...requestContext(context),
    invoiceNumber: draft.invoiceNumber,
  });

  assert.equal(posted.status, "POSTED");
  assert.ok(posted.journalId);

  await assertCounter(context, "JV", 2);

  const igstLedger = await context.models.Ledger.findOne({
    tenantId: context.tenantId,
    code: "OUTPUT_IGST",
  }).lean();

  assert.equal(igstLedger.currentBalance, 36);
  assert.equal(igstLedger.currentBalanceType, "CREDIT");

  const customer = await context.models.Customer
    .findById(fixtures.customer._id)
    .lean();

  assert.equal(customer.receivableBalance, 1416);

  const product = await context.models.Product
    .findById(fixtures.product._id)
    .lean();

  assert.equal(product.currentStock, 8);

  const afterPosting = await snapshotTenant(context);

  await assert.rejects(
    () => salesInvoiceService.postSalesInvoice({
      ...requestContext(context),
      invoiceNumber: draft.invoiceNumber,
    }),
    (error) => error.statusCode === 409,
  );

  assert.deepEqual(
    await snapshotTenant(context),
    afterPosting,
    "Duplicate posting changed tenant data",
  );

  const deletable = await salesInvoiceService.createSalesInvoice({
    ...requestContext(context),
    payload: invoicePayload(fixtures, {
      action: "SAVE_DRAFT",
      quantity: 1,
    }),
  });

  assert.equal(deletable.invoiceNumber, "SI003");

  await salesInvoiceService.deleteSalesInvoice({
    ...requestContext(context),
    invoiceNumber: deletable.invoiceNumber,
  });

  const deleted = await context.models.SalesInvoice
    .findById(deletable._id)
    .lean();

  assert.equal(deleted.isDeleted, true);
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.journalId, null);

  await assert.rejects(
    () => salesInvoiceService.getSalesInvoiceByNumber({
      tenant: getReadyTenant(context),
      invoiceNumber: deletable.invoiceNumber,
    }),
    (error) => error.statusCode === 404,
  );

  await assertCounter(context, "SI", 3);
  await assertCounter(context, "JV", 2);

  console.log(
    "PASS: draft creation, replacement, INTER_STATE posting, duplicate-post protection, and draft soft deletion verified",
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
      ["CU", "PR", "SI", "JV"].map(
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
    "PASS: no matching test records or CU/PR/SI/JV counters found in main database",
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

    const tenantBInitially = await snapshotTenant(contextB);

    const fixturesA = await createFixtures(contextA);

    await verifyFirstPosting(contextA, fixturesA);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBInitially,
      "Tenant B changed during Tenant A creation/posting",
    );

    console.log(
      "PASS: Tenant B remained unchanged after Tenant A posting",
    );

    await verifyInsufficientStock(contextA, fixturesA);
    await verifyLateFailureRollback(contextA, fixturesA);
    await verifyDraftWorkflow(contextA, fixturesA);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBInitially,
      "Tenant B changed during Tenant A operations",
    );

    const tenantACompleted = await snapshotTenant(contextA);

    const fixturesB = await createFixtures(contextB);

    await verifyFirstPosting(contextB, fixturesB);

    assert.deepEqual(
      await snapshotTenant(contextA),
      tenantACompleted,
      "Tenant A changed during Tenant B operations",
    );

    console.log(
      "PASS: both tenants independently use CU001, PR001, SI001, and JV sequence 1",
    );

    await verifyMainDatabase();

    console.log("Tenant Sales Invoice test PASSED");
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
      "Tenant Sales Invoice test FAILED:",
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