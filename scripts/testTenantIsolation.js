const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");

const envResult = require("dotenv").config({
  path: path.resolve(__dirname, "../.env.tenant-test"),
  quiet: true,
});

const { getTenantDatabaseName } = require("../src/tenancy/tenantDatabaseNames");

const {
  getProvisioningConnection,
} = require("../src/tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../src/tenancy/tenantAccountingModels");

const {
  DEFAULT_LEDGER_GROUPS,
  seedDefaultLedgerGroups,
} = require("../src/modules/accounting/seeds/seedDefaultLedgerGroups");

const {
  DEFAULT_LEDGERS,
  seedDefaultLedgers,
} = require("../src/modules/accounting/seeds/seedDefaultLedgers");

const createdTargets = [];

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

  const expectedMainDb = settings.TENANT_TEST_EXPECTED_MAIN_DB?.trim();

  if (
    !uri ||
    (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://"))
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

const createTestContext = (label) => {
  const tenantId = new mongoose.Types.ObjectId();

  const databaseKey = `test_${randomBytes(6).toString("hex")}`;

  const databaseName = getTenantDatabaseName(databaseKey);

  const tenant = {
    _id: tenantId,
    businessName: `Isolation Test ${label}`,
    databaseKey,
    databaseName,
    storageMode: "DEDICATED",
    provisioningStatus: "PROVISIONING",
    isActive: true,
    status: "active",
  };

  const connection = getProvisioningConnection(tenant);

  const models = getTenantAccountingModels(connection);

  return {
    label,
    tenantId,
    databaseName,
    connection,
    models,
  };
};

const provisionTestContext = async (context) => {
  const { tenantId, databaseName, connection, models } = context;

  const collections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  assert.equal(
    collections.length,
    0,
    "Refusing to reuse an existing test database",
  );

  createdTargets.push(databaseName);

  for (const model of [models.LedgerGroup, models.Ledger, models.AuditLog]) {
    assert.equal(model.db, connection, "Model has the wrong connection");

    await model.createCollection();
    await model.createIndexes();
  }

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
    await models.LedgerGroup.countDocuments({
      tenantId,
    }),
    DEFAULT_LEDGER_GROUPS.length,
  );

  assert.equal(
    await models.Ledger.countDocuments({
      tenantId,
    }),
    DEFAULT_LEDGERS.length,
  );

  console.log(`${context.label} provisioned: ${databaseName}`);
};

const verifyIsolation = async (a, b) => {
  assert.notEqual(a.databaseName, b.databaseName);

  assert.notEqual(
    a.models.Ledger,
    b.models.Ledger,
    "Tenants must not share the same model instance",
  );

  // Deliberately omit tenant filters to inspect physical separation.
  const cashA = await a.models.Ledger.findOne({ code: "CASH" }).lean();

  const cashB = await b.models.Ledger.findOne({ code: "CASH" }).lean();

  assert.ok(cashA);
  assert.ok(cashB);

  assert.equal(String(cashA.tenantId), String(a.tenantId));

  assert.equal(String(cashB.tenantId), String(b.tenantId));

  assert.notEqual(String(cashA._id), String(cashB._id));

  assert.equal(
    await a.models.Ledger.countDocuments({
      tenantId: b.tenantId,
    }),
    0,
  );

  assert.equal(
    await b.models.Ledger.countDocuments({
      tenantId: a.tenantId,
    }),
    0,
  );

  assert.equal(await a.models.Ledger.findById(cashB._id).lean(), null);

  assert.equal(await b.models.Ledger.findById(cashA._id).lean(), null);

  console.log("PASS: tenant databases and ledger model instances are separate");

  console.log(
    "PASS: neither database contains the other tenant's test ledgers",
  );

  return { cashA, cashB };
};

const verifyRollback = async (context, cash) => {
  const marker = `ROLLBACK_${randomBytes(6).toString("hex")}`;

  const forcedFailure = new Error("Intentional rollback test");

  const session = await context.connection.startSession();

  let abortedAsExpected = false;

  try {
    await session.withTransaction(async () => {
      const update = await context.models.Ledger.updateOne(
        {
          _id: cash._id,
          tenantId: context.tenantId,
        },
        {
          $set: {
            currentBalance: 123.45,
            currentBalanceType: "DEBIT",
          },
        },
        { session },
      );

      assert.equal(update.matchedCount, 1);

      await context.models.AuditLog.create(
        [
          {
            tenantId: context.tenantId,
            action: marker,
            module: "TENANT_ISOLATION_TEST",
            documentId: cash._id,
          },
        ],
        { session },
      );

      const inside = await context.models.Ledger.findById(cash._id)
        .session(session)
        .lean();

      assert.equal(inside.currentBalance, 123.45);

      throw forcedFailure;
    });
  } catch (error) {
    if (error !== forcedFailure) {
      throw error;
    }

    abortedAsExpected = true;
  } finally {
    await session.endSession();
  }

  assert.equal(abortedAsExpected, true);

  const after = await context.models.Ledger.findById(cash._id).lean();

  assert.ok(after);

  assert.equal(
    after.currentBalance,
    cash.currentBalance,
    "Ledger update was not rolled back",
  );

  assert.equal(after.currentBalanceType, cash.currentBalanceType);

  assert.equal(
    await context.models.AuditLog.countDocuments({
      tenantId: context.tenantId,
      action: marker,
    }),
    0,
    "Audit insert was not rolled back",
  );

  console.log("PASS: forced failure rolled back both ledger and audit writes");
};

const verifyMainDatabase = async (contexts) => {
  const tenantIds = contexts.map((context) => context.tenantId);

  const exampleModels = contexts[0].models;

  for (const model of Object.values(exampleModels)) {
    const count = await mongoose.connection.db
      .collection(model.collection.name)
      .countDocuments({
        tenantId: { $in: tenantIds },
      });

    assert.equal(count, 0, "Test records were found in the main database");
  }

  console.log(
    "PASS: no test tenant records found in checked main-database collections",
  );
};

const run = async () => {
  const { uri, expectedMainDb } = validateConfiguration();

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });

  assert.equal(
    mongoose.connection.name,
    expectedMainDb,
    "Connected database does not match the expected test database",
  );

  console.log("Connected test main database:", mongoose.connection.name);

  process.env.TENANT_DATABASES_ENABLED = "true";

  const a = createTestContext("Tenant A");
  const b = createTestContext("Tenant B");

  await provisionTestContext(a);
  await provisionTestContext(b);

  const { cashA, cashB } = await verifyIsolation(a, b);

  await verifyRollback(a, cashA);

  const unchangedB = await b.models.Ledger.findById(cashB._id).lean();

  assert.ok(unchangedB);

  assert.equal(
    unchangedB.currentBalance,
    cashB.currentBalance,
    "Tenant B changed during Tenant A's test",
  );

  console.log("PASS: Tenant B remained unchanged");

  await verifyMainDatabase([a, b]);

  console.log("Tenant isolation and rollback test PASSED");

  console.log("No Tenant record was saved or marked READY.");

  console.log("No API routing was changed.");
};

run()
  .catch((error) => {
    console.error("Tenant isolation test FAILED:", error.message);

    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdTargets.length) {
      console.log("Test databases retained for inspection:");

      for (const name of createdTargets) {
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
