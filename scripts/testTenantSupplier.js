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

const supplierService = require(
  "../src/modules/suppliers/supplier.service",
);

const NotificationService = require(
  "../src/services/notificationService",
);

const contexts = [];
const createdDatabases = [];
const notificationCalls = [];

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

  return {
    uri,
    expectedMainDb,
  };
};

const createTenantContext = (label) => {
  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const databaseKey = `test_${randomBytes(6).toString("hex")}`;

  const databaseName = getTenantDatabaseName(databaseKey);

  const tenant = {
    _id: tenantId,
    businessName: `Supplier Test ${label}`,
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

  const modelEntries = {
    LedgerGroup: models.LedgerGroup,
    Ledger: models.Ledger,
    Supplier: models.Supplier,
    AuditLog: models.AuditLog,
  };

  for (const [name, model] of Object.entries(modelEntries)) {
    assert.ok(model, `Tenant model is missing: ${name}`);

    assert.equal(
      model.db,
      connection,
      `Tenant model has the wrong connection: ${name}`,
    );
  }

  createdDatabases.push(databaseName);

  for (const model of Object.values(modelEntries)) {
    await model.createCollection();
    await model.createIndexes();
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

  console.log(`${context.label} provisioned: ${databaseName}`);
};

const getCounter = async (context) => {
  return context.connection.db
    .collection("counters")
    .findOne({
      _id: `${context.tenantId}_SU`,
    });
};

const createSupplier = async (
  context,
  supplierName,
  openingBalance = 500,
  openingBalanceType = "CREDIT",
) => {
  return supplierService.createSupplier({
    tenant: getReadyTenant(context),
    userId: context.userId,
    payload: {
      supplierName,
      supplierType: "Business",
      contactPerson: "Test Contact",
      phone: "9876543210",
      email: "supplier@example.com",
      gstNo: "27ABCDE1234F1Z5",
      paymentTerms: "Due on Receipt",
      creditLimit: 10000,
      creditDays: 30,
      openingBalance,
      openingBalanceType,
      status: "Active",
      country: "India",
    },
    ipAddress: "127.0.0.1",
  });
};

const snapshotTenant = async (context) => {
  const snapshot = {};

  for (const name of [
    "Supplier",
    "Ledger",
    "LedgerGroup",
    "AuditLog",
  ]) {
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

const verifyCreation = async (context) => {
  const callsBefore = notificationCalls.length;

  const supplier = await createSupplier(
    context,
    "Tenant A Credit Supplier",
  );

  assert.equal(supplier.supplierCode, "SU001");
  assert.equal(supplier.payableBalance, 500);
  assert.ok(supplier.ledgerId);

  const saved = await context.models.Supplier
    .findById(supplier._id)
    .lean();

  assert.ok(saved);
  assert.equal(String(saved.tenantId), String(context.tenantId));

  const ledger = await context.models.Ledger
    .findById(supplier.ledgerId)
    .lean();

  assert.ok(ledger);
  assert.equal(ledger.code, "SUPP-SU001");
  assert.equal(ledger.name, supplier.supplierName);
  assert.equal(ledger.type, "SUPPLIER");
  assert.equal(ledger.nature, "LIABILITY");
  assert.equal(ledger.normalBalance, "CREDIT");
  assert.equal(ledger.openingBalance, 500);
  assert.equal(ledger.openingBalanceType, "CREDIT");
  assert.equal(ledger.currentBalance, 500);
  assert.equal(ledger.currentBalanceType, "CREDIT");
  assert.equal(ledger.referenceType, "SUPPLIER");
  assert.equal(String(ledger.referenceId), String(supplier._id));
  assert.equal(String(ledger.tenantId), String(context.tenantId));
  assert.equal(ledger.creditLimit, 10000);
  assert.equal(ledger.creditDays, 30);
  assert.equal(ledger.isActive, true);

  const group = await context.models.LedgerGroup
    .findById(ledger.ledgerGroupId)
    .lean();

  assert.ok(group);
  assert.equal(group.code, "SUNDRY_CREDITORS");

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "SUPPLIER",
    action: "CREATE",
    documentId: supplier._id,
  }).lean();

  assert.ok(audit);

  const counter = await getCounter(context);

  assert.ok(counter, "Tenant-local Supplier counter is missing");
  assert.equal(counter.seq, 1);

  assert.equal(notificationCalls.length, callsBefore + 1);

  const notification = notificationCalls[callsBefore];

  assert.equal(notification.type, "NEW_SUPPLIER");
  assert.equal(
    String(notification.tenantId),
    String(context.tenantId),
  );
  assert.equal(
    notification.data.supplierId,
    supplier._id.toString(),
  );

  console.log(
    "PASS: Supplier, linked Ledger, opening payable, CREATE audit, and tenant-local SU001 created",
  );

  return supplier;
};

const verifyIndependentCounters = async (contextA, contextB) => {
  const productCountBefore = await contextB.models.Supplier
    .countDocuments({});

  assert.equal(productCountBefore, 0);
  assert.equal(await getCounter(contextB), null);

  const supplierB = await createSupplier(
    contextB,
    "Tenant B Supplier",
    200,
  );

  assert.equal(supplierB.supplierCode, "SU001");
  assert.equal(supplierB.payableBalance, 200);

  const secondA = await createSupplier(
    contextA,
    "Tenant A Second Supplier",
    0,
  );

  assert.equal(secondA.supplierCode, "SU002");

  assert.equal((await getCounter(contextA)).seq, 2);
  assert.equal((await getCounter(contextB)).seq, 1);

  const crossTenantLookup = await supplierService.getSupplierByCode({
    tenant: getReadyTenant(contextB),
    supplierCode: "SU002",
  });

  assert.equal(crossTenantLookup, null);

  console.log(
    "PASS: Supplier counters are independent and code lookups are tenant-isolated",
  );
};

const verifyDebitOpeningBalance = async (context) => {
  const supplier = await createSupplier(
    context,
    "Tenant A Advance Supplier",
    300,
    "DEBIT",
  );

  assert.equal(supplier.supplierCode, "SU003");
  assert.equal(supplier.payableBalance, 0);

  const ledger = await context.models.Ledger
    .findById(supplier.ledgerId)
    .lean();

  assert.ok(ledger);
  assert.equal(ledger.openingBalance, 300);
  assert.equal(ledger.openingBalanceType, "DEBIT");
  assert.equal(ledger.currentBalance, 300);
  assert.equal(ledger.currentBalanceType, "DEBIT");

  console.log(
    "PASS: DEBIT opening balance retained in Ledger with zero Supplier payable",
  );
};

const verifyReadAndUpdate = async (context, supplier) => {
  const tenant = getReadyTenant(context);

  const found = await supplierService.getSupplierByCode({
    tenant,
    supplierCode: supplier.supplierCode.toLowerCase(),
  });

  assert.ok(found);
  assert.equal(String(found._id), String(supplier._id));

  const updated = await supplierService.updateSupplier({
    tenant,
    userId: context.userId,
    supplierCode: supplier.supplierCode,
    payload: {
      supplierName: "Updated Supplier",
      creditLimit: 25000,
      creditDays: 45,
      status: "Inactive",
      supplierCode: "CHANGED",
      ledgerId: new mongoose.Types.ObjectId(),
      payableBalance: 999999,
    },
    ipAddress: "127.0.0.1",
  });

  assert.equal(updated.supplierName, "Updated Supplier");
  assert.equal(updated.supplierCode, "SU001");
  assert.equal(String(updated.ledgerId), String(supplier.ledgerId));
  assert.equal(updated.payableBalance, 500);

  let ledger = await context.models.Ledger
    .findById(supplier.ledgerId)
    .lean();

  assert.equal(ledger.name, "Updated Supplier");
  assert.equal(ledger.creditLimit, 25000);
  assert.equal(ledger.creditDays, 45);
  assert.equal(ledger.isActive, false);
  assert.equal(ledger.currentBalance, 500);
  assert.equal(ledger.currentBalanceType, "CREDIT");

  const listing = await supplierService.getSuppliers({
    tenant,
    search: "Updated Supplier",
    status: "Inactive",
    page: 1,
    limit: 20,
  });

  assert.equal(listing.pagination.total, 1);
  assert.equal(listing.data.length, 1);
  assert.equal(String(listing.data[0]._id), String(supplier._id));

  const updateAudit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "SUPPLIER",
    action: "UPDATE",
    documentId: supplier._id,
  }).lean();

  assert.ok(updateAudit);

  await supplierService.updateSupplier({
    tenant,
    userId: context.userId,
    supplierCode: supplier.supplierCode,
    payload: {
      status: "Active",
    },
    ipAddress: "127.0.0.1",
  });

  ledger = await context.models.Ledger
    .findById(supplier.ledgerId)
    .lean();

  assert.equal(ledger.isActive, true);

  console.log(
    "PASS: Supplier lookup, listing, protected fields, Ledger synchronization, and UPDATE audit verified",
  );
};

const withForcedAuditFailure = async (context, operation) => {
  const AuditLog = context.models.AuditLog;
  const originalCreate = AuditLog.create;

  const failureMessage = "Intentional Supplier rollback failure";

  let reached = false;

  AuditLog.create = async function (...args) {
    await originalCreate.apply(this, args);

    reached = true;

    throw new Error(failureMessage);
  };

  try {
    await assert.rejects(
      operation,
      (error) => error.message === failureMessage,
    );
  } finally {
    AuditLog.create = originalCreate;
  }

  assert.equal(reached, true, "Failure injection was not reached");
};

const verifyCreateRollback = async (context) => {
  const before = await snapshotTenant(context);
  const callsBefore = notificationCalls.length;

  await withForcedAuditFailure(
    context,
    () => createSupplier(
      context,
      "Supplier That Must Roll Back",
      750,
    ),
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Supplier creation did not fully roll back",
  );

  assert.equal(
    notificationCalls.length,
    callsBefore,
    "Failed creation must not trigger notification",
  );

  console.log(
    "PASS: forced CREATE failure rolled back Supplier, Ledger, audit, and SU counter",
  );
};

const verifyUpdateRollback = async (context, supplier) => {
  const before = await snapshotTenant(context);

  await withForcedAuditFailure(
    context,
    () => supplierService.updateSupplier({
      tenant: getReadyTenant(context),
      userId: context.userId,
      supplierCode: supplier.supplierCode,
      payload: {
        supplierName: "Update That Must Roll Back",
        creditLimit: 50000,
        status: "Inactive",
      },
      ipAddress: "127.0.0.1",
    }),
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Supplier update did not fully roll back",
  );

  console.log(
    "PASS: forced UPDATE failure rolled back Supplier, Ledger changes, and audit",
  );
};

const verifyDeleteRollback = async (context, supplier) => {
  const before = await snapshotTenant(context);

  await withForcedAuditFailure(
    context,
    () => supplierService.deleteSupplier({
      tenant: getReadyTenant(context),
      userId: context.userId,
      supplierCode: supplier.supplierCode,
      ipAddress: "127.0.0.1",
    }),
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Supplier deletion did not fully roll back",
  );

  console.log(
    "PASS: forced DELETE failure rolled back Supplier deletion, Ledger deactivation, and audit",
  );
};

const verifySoftDelete = async (context, supplier) => {
  const tenant = getReadyTenant(context);

  await supplierService.deleteSupplier({
    tenant,
    userId: context.userId,
    supplierCode: supplier.supplierCode,
    ipAddress: "127.0.0.1",
  });

  const deleted = await context.models.Supplier
    .findById(supplier._id)
    .lean();

  assert.ok(deleted);
  assert.equal(deleted.isDeleted, true);
  assert.equal(deleted.status, "Inactive");
  assert.ok(deleted.deletedAt);
  assert.equal(
    String(deleted.deletedBy),
    String(context.userId),
  );

  const ledger = await context.models.Ledger
    .findById(supplier.ledgerId)
    .lean();

  assert.ok(ledger);
  assert.equal(ledger.isActive, false);

  const visible = await supplierService.getSupplierByCode({
    tenant,
    supplierCode: supplier.supplierCode,
  });

  assert.equal(visible, null);

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "SUPPLIER",
    action: "DELETE",
    documentId: supplier._id,
  }).lean();

  assert.ok(audit);

  console.log(
    "PASS: Supplier soft deletion, linked Ledger deactivation, and DELETE audit verified",
  );
};

const verifyMainDatabase = async () => {
  const tenantIds = contexts.map((context) => context.tenantId);

  const collectionNames = new Set();

  for (const context of contexts) {
    for (const name of [
      "Supplier",
      "Ledger",
      "LedgerGroup",
      "AuditLog",
    ]) {
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
    const counterIds = contexts.map(
      (context) => `${context.tenantId}_SU`,
    );

    assert.equal(
      await mongoose.connection.db
        .collection("counters")
        .countDocuments({
          _id: { $in: counterIds },
        }),
      0,
      "Supplier counters leaked into the main database",
    );
  }

  console.log(
    "PASS: no Supplier, Ledger, group, audit, or Supplier counter test records found in main database",
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

  const originalNotification =
    NotificationService.createForTenant;

  assert.equal(
    typeof originalNotification,
    "function",
    "NotificationService.createForTenant is missing",
  );

  NotificationService.createForTenant = async (payload) => {
    notificationCalls.push(payload);

    return null;
  };

  try {
    const contextA = createTenantContext("Tenant A");
    const contextB = createTenantContext("Tenant B");

    await provisionTenant(contextA);
    await provisionTenant(contextB);

    const tenantBInitially = await snapshotTenant(contextB);

    const supplierA = await verifyCreation(contextA);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBInitially,
      "Tenant B changed during Tenant A creation",
    );

    console.log(
      "PASS: Tenant B remained unchanged after Tenant A creation",
    );

    await verifyIndependentCounters(contextA, contextB);

    const tenantBBefore = await snapshotTenant(contextB);

    await verifyDebitOpeningBalance(contextA);
    await verifyReadAndUpdate(contextA, supplierA);
    await verifyCreateRollback(contextA);
    await verifyUpdateRollback(contextA, supplierA);
    await verifyDeleteRollback(contextA, supplierA);
    await verifySoftDelete(contextA, supplierA);

    assert.deepEqual(
      await snapshotTenant(contextB),
      tenantBBefore,
      "Tenant B changed during Tenant A operations",
    );

    console.log(
      "PASS: Tenant B remained unchanged during Tenant A operations",
    );

    await verifyMainDatabase();

    console.log("Tenant Supplier test PASSED");
    console.log("Notifications were stubbed; no notifications were sent.");
    console.log("No Tenant record was saved or marked READY.");
    console.log("No API routing was changed.");
  } finally {
    NotificationService.createForTenant = originalNotification;
  }
};

run()
  .catch((error) => {
    console.error(
      "Tenant Supplier test FAILED:",
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