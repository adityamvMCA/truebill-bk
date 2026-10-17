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

const supplierService = require(
  "../src/modules/suppliers/supplier.service",
);

const productService = require(
  "../src/modules/products/product.service",
);

const purchaseBillService = require(
  "../src/modules/purchase-bills/purchaseBill.service",
);

const supplierPaymentService = require(
  "../src/modules/supplier-payments/supplierPayment.service",
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
  "Supplier",
  "Product",
  "PurchaseBill",
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
    businessName: `Supplier Payment Test ${label}`,
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

    if (name === "SupplierPayment") {
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
  const supplier = await supplierService.createSupplier({
    ...requestContext(context),
    payload: {
      supplierName: `${context.label} Payment Supplier`,
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
      name: `${context.label} Payment Test Product`,
      type: "GOODS",
      unit: "NOS",
      gstRate: 18,
      salePrice: 150,
      purchasePrice: 100,
      trackInventory: true,
      openingStock: 0,
      openingStockRate: 0,
      reorderLevel: 2,
      status: "ACTIVE",
    },
  });

  const billDate = new Date().toISOString().slice(0, 10);

  const dueDate = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const bills = [];

  for (const quantity of [10, 5]) {
    const bill = await purchaseBillService.createPurchaseBill({
      ...requestContext(context),
      payload: {
        action: "SAVEANDPOST",
        supplierId: supplier._id.toString(),
        supplierInvoiceNumber: `INV-${randomUUID()}`,
        billDate,
        dueDate,
        paymentTerms: "Due on Receipt",
        taxMode: "INTRASTATE",
        updateStock: true,
        items: [
          {
            productId: product._id.toString(),
            quantity,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
            taxCreditEligible: true,
          },
        ],
      },
    });

    assert.equal(bill.status, "POSTED");

    bills.push(bill);
  }

  assert.equal(bills[0].totalAmountPaise, 118000);
  assert.equal(bills[1].totalAmountPaise, 59000);

  const cashLedger = await context.models.Ledger.findOne({
    tenantId: context.tenantId,
    code: "CASH",
    type: "CASH",
    nature: "ASSET",
    isActive: true,
  });

  assert.ok(cashLedger, "Seeded CASH Ledger is missing");

  cashLedger.openingBalance = 2000;
  cashLedger.openingBalanceType = "DEBIT";
  cashLedger.currentBalance = 2000;
  cashLedger.currentBalanceType = "DEBIT";

  await cashLedger.save();

  const bankGroup = await context.models.LedgerGroup.findOne({
    tenantId: context.tenantId,
    code: "BANK_ACCOUNTS",
    isActive: true,
  }).lean();

  assert.ok(bankGroup, "BANK_ACCOUNTS group is missing");

  const bankLedger = await context.models.Ledger.create({
    tenantId: context.tenantId,
    ledgerGroupId: bankGroup._id,
    code: "TEST_PAYMENT_BANK",
    name: "Test Payment Bank",
    type: "BANK",
    nature: "ASSET",
    normalBalance: "DEBIT",
    openingBalance: 3000,
    openingBalanceType: "DEBIT",
    currentBalance: 3000,
    currentBalanceType: "DEBIT",
    referenceType: "BANK",
    referenceId: new mongoose.Types.ObjectId(),
    isSystem: false,
    isActive: true,
    createdBy: context.userId,
    updatedBy: context.userId,
  });

  const cashGroup = await context.models.LedgerGroup.findOne({
    tenantId: context.tenantId,
    code: "CASH_IN_HAND",
    isActive: true,
  }).lean();

  assert.ok(cashGroup, "CASH_IN_HAND group is missing");

  const emptyCashLedger = await context.models.Ledger.create({
    tenantId: context.tenantId,
    ledgerGroupId: cashGroup._id,
    code: "TEST_EMPTY_CASH",
    name: "Test Empty Cash",
    type: "CASH",
    nature: "ASSET",
    normalBalance: "DEBIT",
    openingBalance: 0,
    openingBalanceType: "DEBIT",
    currentBalance: 0,
    currentBalanceType: "DEBIT",
    isSystem: false,
    isActive: true,
    createdBy: context.userId,
    updatedBy: context.userId,
  });

  const savedSupplier = await context.models.Supplier
    .findById(supplier._id)
    .lean();

  assert.equal(savedSupplier.payableBalance, 1770);

  const savedProduct = await context.models.Product
    .findById(product._id)
    .lean();

  assert.equal(savedProduct.currentStock, 15);

  await assertCounter(context, "SU", 1);
  await assertCounter(context, "PR", 1);
  await assertCounter(context, "PB", 2);
  await assertCounter(context, "JV", 2);

  console.log(
    `PASS: ${context.label} Supplier, Product, two posted bills, and funded payment Ledgers created`,
  );

  return {
    supplier,
    product,
    bills,
    cashLedger,
    bankLedger,
    emptyCashLedger,
  };
};

const paymentPayload = (
  fixtures,
  {
    requestId = randomUUID(),
    paymentLedgerId = fixtures.cashLedger._id,
    paymentMethod = "CASH",
    amount = 500,
    allocations = [
      {
        purchaseBillId: fixtures.bills[0]._id.toString(),
        amount: 500,
      },
    ],
  } = {},
) => ({
  requestId,
  supplierId: fixtures.supplier._id.toString(),
  paymentLedgerId: paymentLedgerId.toString(),
  paymentDate: new Date().toISOString().slice(0, 10),
  paymentMethod,
  referenceNumber: "PAYMENT-TEST",
  amount,
  allocations,
  notes: "Tenant Supplier Payment integration test",
});

const assertSupplierBalance = async (
  context,
  fixtures,
  expected,
) => {
  const supplier = await context.models.Supplier
    .findById(fixtures.supplier._id)
    .lean();

  const ledger = await context.models.Ledger
    .findById(fixtures.supplier.ledgerId)
    .lean();

  assert.ok(supplier);
  assert.ok(ledger);

  assert.equal(supplier.payableBalance, expected);
  assert.equal(ledger.currentBalance, expected);
  assert.equal(ledger.currentBalanceType, "CREDIT");
};

const verifyPartialPayment = async (context, fixtures) => {
  const payload = paymentPayload(fixtures);

  const notificationsBefore = notificationCalls.length;

  const result = await supplierPaymentService.createSupplierPayment({
    ...requestContext(context),
    payload,
  });

  assert.equal(result.replayed, false);

  const payment = result.payment;

  assert.equal(payment.paymentNumber, "SP001");
  assert.equal(payment.status, "POSTED");
  assert.equal(payment.amountPaise, 50000);
  assert.equal(payment.paymentLedgerType, "CASH");
  assert.equal(payment.allocations.length, 1);
  assert.equal(payment.allocations[0].amountPaise, 50000);
  assert.equal(payment.requestHash, undefined);

  const stored = await context.models.SupplierPayment
    .findById(payment._id)
    .select("+requestHash")
    .lean();

  assert.ok(stored);
  assert.match(stored.requestHash, /^[0-9a-f]{64}$/);

  const journal = await context.models.Journal
    .findById(payment.journalId)
    .lean();

  assert.ok(journal);
  assert.equal(journal.sourceType, "SUPPLIER_PAYMENT");
  assert.equal(String(journal.sourceId), String(payment._id));
  assert.equal(journal.totalDebitPaise, 50000);
  assert.equal(journal.totalCreditPaise, 50000);

  const supplierLine = journal.lines.find(
    (line) =>
      String(line.ledgerId) === String(fixtures.supplier.ledgerId),
  );

  const cashLine = journal.lines.find(
    (line) =>
      String(line.ledgerId) === String(fixtures.cashLedger._id),
  );

  assert.ok(supplierLine);
  assert.ok(cashLine);

  assert.equal(supplierLine.debitPaise, 50000);
  assert.equal(supplierLine.creditPaise, 0);
  assert.equal(cashLine.debitPaise, 0);
  assert.equal(cashLine.creditPaise, 50000);

  const bill = await context.models.PurchaseBill
    .findById(fixtures.bills[0]._id)
    .lean();

  assert.equal(bill.paidAmountPaise, 50000);
  assert.equal(bill.outstandingAmountPaise, 68000);
  assert.equal(bill.paymentStatus, "PARTIALLY_PAID");

  await assertSupplierBalance(context, fixtures, 1270);

  const cash = await context.models.Ledger
    .findById(fixtures.cashLedger._id)
    .lean();

  assert.equal(cash.currentBalance, 1500);
  assert.equal(cash.currentBalanceType, "DEBIT");

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "SUPPLIER_PAYMENT",
    action: "CREATE",
    documentId: payment._id,
  }).lean();

  assert.ok(audit);

  await assertCounter(context, "SP", 1);
  await assertCounter(context, "JV", 3);

  assert.equal(notificationCalls.length, notificationsBefore + 1);

  assert.equal(
    notificationCalls[notificationsBefore].type,
    "SUPPLIER_PAYMENT",
  );

  console.log(
    "PASS: partial CASH payment, Journal, bill allocation, payable, audit, and SP/JV counters verified",
  );

  return { payload, payment };
};

const verifyReplay = async (context, partial) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  const replay = await supplierPaymentService.createSupplierPayment({
    ...requestContext(context),
    payload: partial.payload,
  });

  assert.equal(replay.replayed, true);

  assert.equal(
    String(replay.payment._id),
    String(partial.payment._id),
  );

  assert.equal(replay.payment.requestHash, undefined);

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Idempotent replay changed tenant data",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  await assert.rejects(
    () => supplierPaymentService.createSupplierPayment({
      ...requestContext(context),
      payload: {
        ...partial.payload,
        notes: "Different content with the same requestId",
      },
    }),
    (error) =>
      error.statusCode === 409 &&
      /already used for a different payment/i.test(error.message),
  );

  assert.deepEqual(await snapshotTenant(context), before);

  console.log(
    "PASS: identical request replayed without writes; changed content with reused requestId rejected",
  );
};

const verifyInsufficientFunds = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  await assert.rejects(
    () => supplierPaymentService.createSupplierPayment({
      ...requestContext(context),
      payload: paymentPayload(fixtures, {
        paymentLedgerId: fixtures.emptyCashLedger._id,
        amount: 100,
        allocations: [
          {
            purchaseBillId: fixtures.bills[0]._id.toString(),
            amount: 100,
          },
        ],
      }),
    }),
    (error) =>
      error.statusCode === 409 &&
      /Insufficient recorded balance/i.test(error.message),
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Insufficient-funds rejection changed tenant data",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  console.log(
    "PASS: payment from an unfunded Ledger rejected without writes",
  );
};

const verifyOverAllocation = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  await assert.rejects(
    () => supplierPaymentService.createSupplierPayment({
      ...requestContext(context),
      payload: paymentPayload(fixtures, {
        amount: 700,
        allocations: [
          {
            purchaseBillId: fixtures.bills[0]._id.toString(),
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

  console.log("PASS: bill over-allocation rejected without writes");
};

const verifyLateRollback = async (context, fixtures) => {
  const before = await snapshotTenant(context);
  const notificationsBefore = notificationCalls.length;

  const AuditLog = context.models.AuditLog;
  const originalCreate = AuditLog.create;

  const message = "Intentional Supplier Payment audit failure";

  let failureReached = false;

  AuditLog.create = async function (...args) {
    const result = await originalCreate.apply(this, args);

    const documents = Array.isArray(args[0])
      ? args[0]
      : [args[0]];

    if (
      documents.some(
        (document) =>
          document?.module === "SUPPLIER_PAYMENT" &&
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
      () => supplierPaymentService.createSupplierPayment({
        ...requestContext(context),
        payload: paymentPayload(fixtures, {
          amount: 100,
          allocations: [
            {
              purchaseBillId: fixtures.bills[0]._id.toString(),
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
    "Late Supplier Payment failure did not fully roll back",
  );

  assert.equal(notificationCalls.length, notificationsBefore);

  console.log(
    "PASS: late failure rolled back payment, Journal, Ledgers, bill allocations, Supplier, audits, and SP/JV counters",
  );
};

const verifyFullSettlement = async (context, fixtures) => {
  const result = await supplierPaymentService.createSupplierPayment({
    ...requestContext(context),
    payload: paymentPayload(fixtures, {
      paymentLedgerId: fixtures.bankLedger._id,
      paymentMethod: "BANK_TRANSFER",
      amount: 1270,
      allocations: [
        {
          purchaseBillId: fixtures.bills[0]._id.toString(),
          amount: 680,
        },
        {
          purchaseBillId: fixtures.bills[1]._id.toString(),
          amount: 590,
        },
      ],
    }),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.payment.paymentNumber, "SP002");
  assert.equal(result.payment.paymentLedgerType, "BANK");
  assert.equal(result.payment.amountPaise, 127000);
  assert.equal(result.payment.allocations.length, 2);

  for (const original of fixtures.bills) {
    const bill = await context.models.PurchaseBill
      .findById(original._id)
      .lean();

    assert.equal(bill.paymentStatus, "PAID");
    assert.equal(bill.outstandingAmountPaise, 0);
    assert.equal(bill.paidAmountPaise, bill.totalAmountPaise);
  }

  await assertSupplierBalance(context, fixtures, 0);

  const bank = await context.models.Ledger
    .findById(fixtures.bankLedger._id)
    .lean();

  assert.equal(bank.currentBalance, 1730);
  assert.equal(bank.currentBalanceType, "DEBIT");

  const cash = await context.models.Ledger
    .findById(fixtures.cashLedger._id)
    .lean();

  assert.equal(cash.currentBalance, 1500);

  const journal = await context.models.Journal
    .findById(result.payment.journalId)
    .lean();

  assert.ok(journal);
  assert.equal(journal.totalDebitPaise, 127000);
  assert.equal(journal.totalCreditPaise, 127000);

  const bankLine = journal.lines.find(
    (line) =>
      String(line.ledgerId) === String(fixtures.bankLedger._id),
  );

  assert.ok(bankLine);
  assert.equal(bankLine.creditPaise, 127000);
  assert.equal(bankLine.debitPaise, 0);

  const unpaid = await supplierPaymentService.getUnpaidSupplierBills({
    tenant: getReadyTenant(context),
    supplierId: fixtures.supplier._id.toString(),
  });

  assert.equal(unpaid.pagination.total, 0);
  assert.equal(unpaid.data.length, 0);

  await assertCounter(context, "SP", 2);
  await assertCounter(context, "JV", 4);

  console.log(
    "PASS: BANK payment settled two bills, reduced Bank balance, and cleared Supplier payable",
  );
};

const verifyReadEndpoints = async (context, fixtures, partial) => {
  const tenant = getReadyTenant(context);

  const payment = await supplierPaymentService
    .getSupplierPaymentByNumber({
      tenant,
      paymentNumber: "sp001",
    });

  assert.equal(String(payment._id), String(partial.payment._id));
  assert.equal(payment.requestHash, undefined);
  assert.ok(payment.journalNumber);

  const journal = await context.models.Journal
    .findById(payment.journalId)
    .lean();

  assert.equal(payment.journalNumber, journal.journalNumber);

  const listing = await supplierPaymentService.getSupplierPayments({
    tenant,
    supplierId: fixtures.supplier._id.toString(),
    page: 1,
    limit: 20,
  });

  assert.equal(listing.pagination.total, 2);
  assert.equal(listing.data.length, 2);

  for (const item of listing.data) {
    assert.equal(item.requestHash, undefined);
    assert.equal(item.allocations, undefined);
  }

  const ledgers = await supplierPaymentService.getPaymentLedgers({
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

  const billPayments = await purchaseBillService.getPurchaseBillPayments({
    tenant,
    billNumber: fixtures.bills[0].billNumber,
    page: 1,
    limit: 20,
  });

  assert.equal(billPayments.pagination.total, 2);

  const allocatedTotal = billPayments.data.reduce(
    (sum, item) => sum + item.allocatedAmountPaise,
    0,
  );

  assert.equal(allocatedTotal, 118000);

  console.log(
    "PASS: payment lookup with Journal number, listing, unpaid bills, payment Ledgers, and Purchase Bill payment history verified",
  );
};

const verifyTenantBPayment = async (
  context,
  fixtures,
  sharedRequestId,
) => {
  const result = await supplierPaymentService.createSupplierPayment({
    ...requestContext(context),
    payload: paymentPayload(fixtures, {
      requestId: sharedRequestId,
    }),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.payment.paymentNumber, "SP001");

  await assertCounter(context, "SP", 1);
  await assertCounter(context, "JV", 3);

  await assertSupplierBalance(context, fixtures, 1270);

  console.log(
    "PASS: Tenant B independently created SP001 using the same requestId without replaying Tenant A",
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
    () => supplierPaymentService.createSupplierPayment({
      ...requestContext(contextB),
      payload: paymentPayload(fixturesB, {
        amount: 100,
        allocations: [
          {
            purchaseBillId: fixturesA.bills[0]._id.toString(),
            amount: 100,
          },
        ],
      }),
    }),
    (error) =>
      error.statusCode === 409 &&
      /selected bills are unavailable/i.test(error.message),
  );

  assert.deepEqual(await snapshotTenant(contextA), beforeA);
  assert.deepEqual(await snapshotTenant(contextB), beforeB);

  console.log(
    "PASS: cross-tenant bill allocation rejected without changing either tenant",
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
      ["SU", "PR", "PB", "SP", "JV"].map(
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
    "PASS: no matching test records or SU/PR/PB/SP/JV counters found in main database",
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

  NotificationService.create = async (payload) => {
    notificationCalls.push(payload);
    return null;
  };

  NotificationService.createForTenant = async (payload) => {
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

    const partial = await verifyPartialPayment(contextA, fixturesA);

    await verifyReplay(contextA, partial);
    await verifyInsufficientFunds(contextA, fixturesA);
    await verifyOverAllocation(contextA, fixturesA);
    await verifyLateRollback(contextA, fixturesA);
    await verifyFullSettlement(contextA, fixturesA);
    await verifyReadEndpoints(contextA, fixturesA, partial);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBBefore,
      "Tenant B changed during Tenant A payment operations",
    );

    console.log(
      "PASS: Tenant B remained unchanged during Tenant A payment operations",
    );

    const tenantACompleted = await snapshotTenant(contextA);

    await verifyTenantBPayment(
      contextB,
      fixturesB,
      partial.payload.requestId,
    );

    assert.deepEqual(
      await snapshotTenant(contextA),
      tenantACompleted,
      "Tenant A changed during Tenant B payment operations",
    );

    await verifyCrossTenantAllocation(
      contextA,
      fixturesA,
      contextB,
      fixturesB,
    );

    await verifyMainDatabase();

    console.log("Tenant Supplier Payment test PASSED");
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
      "Tenant Supplier Payment test FAILED:",
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