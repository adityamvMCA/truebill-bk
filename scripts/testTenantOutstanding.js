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

const {
  getOutstanding,
} = require("../src/modules/outstanding/outstanding.service");

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
    businessName: `Outstanding Test ${label}`,
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

const getIstDay = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${fields.year}-${fields.month}-${fields.day}`;
};

const shiftDay = (day, offset) => {
  const date = new Date(`${day}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + offset);

  return date.toISOString().slice(0, 10);
};

const makeDates = () => {
  const today = getIstDay();

  return {
    today,
    documentDate: `${shiftDay(today, -20)}T00:00:00+05:30`,
    overdueDate: `${shiftDay(today, -10)}T00:00:00+05:30`,
    todayDueDate: `${today}T00:00:00+05:30`,
    futureDate: `${shiftDay(today, 7)}T00:00:00+05:30`,
    paymentDate: `${today}T00:00:00+05:30`,
  };
};

const createFixtures = async (context, dates) => {
  const customers = [];
  const suppliers = [];

  for (const suffix of ["Alpha", "Beta"]) {
    customers.push(
      await customerService.createCustomer({
        ...requestContext(context),
        payload: {
          customerName: `${context.label} ${suffix} Customer`,
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
      }),
    );

    suppliers.push(
      await supplierService.createSupplier({
        ...requestContext(context),
        payload: {
          supplierName: `${context.label} ${suffix} Supplier`,
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
      }),
    );
  }

  const product = await productService.createProduct({
    ...requestContext(context),
    payload: {
      name: `${context.label} Report Service`,
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

  const definitions = [
    {
      partyIndex: 0,
      quantity: 10,
      dueDate: dates.overdueDate,
      posted: true,
    },
    {
      partyIndex: 0,
      quantity: 5,
      dueDate: dates.futureDate,
      posted: true,
    },
    {
      partyIndex: 1,
      quantity: 2,
      dueDate: dates.todayDueDate,
      posted: true,
    },
    {
      partyIndex: 0,
      quantity: 1,
      dueDate: dates.overdueDate,
      posted: false,
    },
  ];

  const invoices = [];
  const bills = [];

  for (const definition of definitions) {
    const item = {
      productId: product._id.toString(),
      quantity: definition.quantity,
      unitRate: 100,
      discountPercent: 0,
      gstRate: 18,
    };

    const invoice = await salesInvoiceService.createSalesInvoice({
      ...requestContext(context),
      payload: {
        action: definition.posted
          ? "SAVE_AND_POST"
          : "SAVE_DRAFT",
        customerId:
          customers[definition.partyIndex]._id.toString(),
        invoiceDate: dates.documentDate,
        dueDate: definition.dueDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRA_STATE",
        updateStock: false,
        items: [item],
      },
    });

    const bill = await purchaseBillService.createPurchaseBill({
      ...requestContext(context),
      payload: {
        action: definition.posted
          ? "SAVEANDPOST"
          : "SAVE_DRAFT",
        supplierId:
          suppliers[definition.partyIndex]._id.toString(),
        supplierInvoiceNumber: `REPORT-${randomUUID()}`,
        billDate: dates.documentDate,
        dueDate: definition.dueDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRASTATE",
        updateStock: false,
        items: [
          {
            ...item,
            taxCreditEligible: true,
          },
        ],
      },
    });

    assert.equal(
      invoice.status,
      definition.posted ? "POSTED" : "DRAFT",
    );

    assert.equal(
      bill.status,
      definition.posted ? "POSTED" : "DRAFT",
    );

    invoices.push(invoice);
    bills.push(bill);
  }

  const cash = await context.models.Ledger.findOne({
    tenantId: context.tenantId,
    code: "CASH",
    type: "CASH",
    isActive: true,
  });

  assert.ok(cash, "Seeded CASH Ledger is missing");

  cash.openingBalance = 10000;
  cash.openingBalanceType = "DEBIT";
  cash.currentBalance = 10000;
  cash.currentBalanceType = "DEBIT";

  await cash.save();

  console.log(
    `PASS: ${context.label} overdue, future-due, due-today, and draft fixtures created`,
  );

  return {
    customers,
    suppliers,
    product,
    invoices,
    bills,
    cash,
  };
};

const report = (context, kind, options = {}) =>
  getOutstanding({
    ...options,
    tenant: getReadyTenant(context),
    kind,
  });

const assertTotals = (
  result,
  {
    documents,
    parties,
    outstanding,
    overdue,
    notDue,
  },
) => {
  assert.deepEqual(result.totals, {
    documentCount: documents,
    partyCount: parties,
    outstandingAmountPaise: outstanding,
    overdueAmountPaise: overdue,
    notDueAmountPaise: notDue,
  });

  assert.equal(result.basis, "CURRENT_POSTED_DOCUMENTS");
  assert.equal(result.currency, "INR");
  assert.equal(result.timezone, "Asia/Kolkata");
};

const verifyInitialReports = async (context, fixtures) => {
  const before = await snapshotTenant(context);

  for (const kind of ["customer", "supplier"]) {
    const partyReport = await report(context, kind);

    assertTotals(partyReport, {
      documents: 3,
      parties: 2,
      outstanding: 200600,
      overdue: 118000,
      notDue: 82600,
    });

    assert.equal(partyReport.data.length, 2);
    assert.equal(partyReport.pagination.total, 2);
    assert.equal(
      partyReport.data[0].outstandingAmountPaise,
      177000,
    );
    assert.equal(partyReport.data[0].documentCount, 2);

    const documentReport = await report(context, kind, {
      view: "document",
    });

    assertTotals(documentReport, {
      documents: 3,
      parties: 2,
      outstanding: 200600,
      overdue: 118000,
      notDue: 82600,
    });

    assert.equal(documentReport.data.length, 3);
    assert.equal(documentReport.pagination.total, 3);

    const overdueRow = documentReport.data.find(
      (row) => row.outstandingAmountPaise === 118000,
    );

    const todayRow = documentReport.data.find(
      (row) => row.outstandingAmountPaise === 23600,
    );

    const futureRow = documentReport.data.find(
      (row) => row.outstandingAmountPaise === 59000,
    );

    assert.ok(overdueRow);
    assert.equal(overdueRow.isOverdue, true);
    assert.equal(overdueRow.overdueDays, 10);

    assert.ok(todayRow);
    assert.equal(todayRow.isOverdue, false);
    assert.equal(todayRow.overdueDays, 0);

    assert.ok(futureRow);
    assert.equal(futureRow.isOverdue, false);
    assert.equal(futureRow.overdueDays, 0);

    const overdueOnly = await report(context, kind, {
      view: "document",
      overdueOnly: true,
    });

    assertTotals(overdueOnly, {
      documents: 1,
      parties: 1,
      outstanding: 118000,
      overdue: 118000,
      notDue: 0,
    });

    assert.equal(overdueOnly.data.length, 1);

    const paged = await report(context, kind, {
      view: "document",
      page: 2,
      limit: 1,
    });

    assert.equal(paged.data.length, 1);
    assert.equal(paged.pagination.total, 3);
    assert.equal(paged.pagination.totalPages, 3);
    assert.equal(
      paged.totals.outstandingAmountPaise,
      200600,
    );

    const partyPaged = await report(context, kind, {
      view: "party",
      page: 2,
      limit: 1,
    });

    assert.equal(partyPaged.data.length, 1);
    assert.equal(partyPaged.pagination.total, 2);
    assert.equal(partyPaged.pagination.totalPages, 2);
    assert.equal(
      partyPaged.totals.outstandingAmountPaise,
      200600,
    );

    const party = kind === "customer"
      ? fixtures.customers[0]
      : fixtures.suppliers[0];

    const filtered = await report(context, kind, {
      partyId: party._id.toString(),
    });

    assertTotals(filtered, {
      documents: 2,
      parties: 1,
      outstanding: 177000,
      overdue: 118000,
      notDue: 59000,
    });

    const document = kind === "customer"
      ? fixtures.invoices[0]
      : fixtures.bills[0];

    const number = kind === "customer"
      ? document.invoiceNumber
      : document.billNumber;

    const searched = await report(context, kind, {
      view: "document",
      search: number,
    });

    assert.equal(searched.pagination.total, 1);
    assert.equal(searched.data[0].documentNumber, number);

    const missing = await report(context, kind, {
      search: "NO_SUCH_REPORT_PARTY",
    });

    assertTotals(missing, {
      documents: 0,
      parties: 0,
      outstanding: 0,
      overdue: 0,
      notDue: 0,
    });

    assert.equal(missing.data.length, 0);
    assert.equal(missing.pagination.total, 0);
  }

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Outstanding reports changed tenant data",
  );

  console.log(
    "PASS: both report types, views, overdue rules, filters, pagination totals, draft exclusion, and read-only behavior verified",
  );
};

const makePayments = async (
  context,
  fixtures,
  dates,
  amount,
) => {
  await customerReceiptService.createCustomerReceipt({
    ...requestContext(context),
    payload: {
      requestId: randomUUID(),
      customerId: fixtures.customers[0]._id.toString(),
      receiptLedgerId: fixtures.cash._id.toString(),
      receiptDate: dates.paymentDate,
      receiptMethod: "CASH",
      amount,
      allocations: [
        {
          salesInvoiceId: fixtures.invoices[0]._id.toString(),
          amount,
        },
      ],
    },
  });

  await supplierPaymentService.createSupplierPayment({
    ...requestContext(context),
    payload: {
      requestId: randomUUID(),
      supplierId: fixtures.suppliers[0]._id.toString(),
      paymentLedgerId: fixtures.cash._id.toString(),
      paymentDate: dates.paymentDate,
      paymentMethod: "CASH",
      amount,
      allocations: [
        {
          purchaseBillId: fixtures.bills[0]._id.toString(),
          amount,
        },
      ],
    },
  });
};

const verifyPaymentChanges = async (context, fixtures, dates) => {
  await makePayments(context, fixtures, dates, 500);

  for (const kind of ["customer", "supplier"]) {
    const result = await report(context, kind, {
      view: "document",
    });

    assertTotals(result, {
      documents: 3,
      parties: 2,
      outstanding: 150600,
      overdue: 68000,
      notDue: 82600,
    });

    const partial = result.data.find(
      (row) => row.outstandingAmountPaise === 68000,
    );

    assert.ok(partial);
    assert.equal(partial.paymentStatus, "PARTIALLY_PAID");
    assert.equal(partial.paidAmountPaise, 50000);

    const overdue = await report(context, kind, {
      overdueOnly: true,
    });

    assert.equal(overdue.totals.outstandingAmountPaise, 68000);
  }

  console.log(
    "PASS: Customer receipt and Supplier payment reduced report outstanding and overdue totals",
  );

  await makePayments(context, fixtures, dates, 680);

  const beforeReports = await snapshotTenant(context);

  for (const kind of ["customer", "supplier"]) {
    const result = await report(context, kind, {
      view: "document",
    });

    assertTotals(result, {
      documents: 2,
      parties: 2,
      outstanding: 82600,
      overdue: 0,
      notDue: 82600,
    });

    assert.equal(result.data.length, 2);

    const settledId = kind === "customer"
      ? fixtures.invoices[0]._id
      : fixtures.bills[0]._id;

    assert.equal(
      result.data.some(
        (row) => String(row._id) === String(settledId),
      ),
      false,
    );

    const overdueOnly = await report(context, kind, {
      overdueOnly: true,
    });

    assertTotals(overdueOnly, {
      documents: 0,
      parties: 0,
      outstanding: 0,
      overdue: 0,
      notDue: 0,
    });
  }

  assert.deepEqual(
    await snapshotTenant(context),
    beforeReports,
    "Post-settlement reports changed tenant data",
  );

  console.log(
    "PASS: fully settled documents excluded and overdue-only reports returned empty totals",
  );
};

const verifyCrossTenantFilters = async (
  contextA,
  fixturesA,
  contextB,
) => {
  for (const kind of ["customer", "supplier"]) {
    const foreignParty = kind === "customer"
      ? fixturesA.customers[0]
      : fixturesA.suppliers[0];

    const result = await report(contextB, kind, {
      partyId: foreignParty._id.toString(),
    });

    assertTotals(result, {
      documents: 0,
      parties: 0,
      outstanding: 0,
      overdue: 0,
      notDue: 0,
    });
  }

  console.log(
    "PASS: foreign-tenant party filters returned no documents",
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
      ["CU", "SU", "PR", "SI", "PB", "CR", "SP", "JV"].map(
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

    await verifyInitialReports(contextA, fixturesA);
    await verifyInitialReports(contextB, fixturesB);

    const tenantBBefore = await snapshotTenant(contextB);

    await verifyPaymentChanges(contextA, fixturesA, dates);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBBefore,
      "Tenant B changed during Tenant A payments/reports",
    );

    for (const kind of ["customer", "supplier"]) {
      const tenantBReport = await report(contextB, kind);

      assert.equal(
        tenantBReport.totals.outstandingAmountPaise,
        200600,
      );
    }

    await verifyCrossTenantFilters(
      contextA,
      fixturesA,
      contextB,
    );

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBBefore,
      "Tenant B report queries changed tenant data",
    );

    assert.equal(
      getIstDay(),
      dates.today,
      "Test crossed midnight in Asia/Kolkata; rerun for stable due-today assertions",
    );

    console.log(
      "PASS: Tenant B balances and reports remained isolated from Tenant A",
    );

    await verifyMainDatabase();

    console.log("Tenant Outstanding test PASSED");
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
      "Tenant Outstanding test FAILED:",
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