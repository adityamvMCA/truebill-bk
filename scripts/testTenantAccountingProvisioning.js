const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");

const dotenvResult = require("dotenv").config({
  path: path.resolve(__dirname, "../.env.tenant-test"),
  quiet: true,
});

const mongoose = require("mongoose");

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

const validateConfiguration = () => {
  if (!process.argv.includes("--run")) {
    throw new Error(
      "Explicit --run argument is required. No connection was opened.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("This test must not run in production mode.");
  }

  if (dotenvResult.error) {
    throw new Error(
      "Could not load .env.tenant-test. Check that the file exists and is readable.",
    );
  }

  /*
    Read these test settings directly from the test file.
    Do not silently use a stale terminal variable or MONGO_URI.
  */
  const testSettings = dotenvResult.parsed || {};

  const uri = testSettings.TENANT_TEST_MONGO_URI?.trim();

  const expectedMainDb = testSettings.TENANT_TEST_EXPECTED_MAIN_DB?.trim();

  if (!uri) {
    throw new Error("TENANT_TEST_MONGO_URI is required in .env.tenant-test.");
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error(
      "TENANT_TEST_MONGO_URI must be a MongoDB connection string.",
    );
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

const createCollectionsAndIndexes = async (models) => {
  const modelList = [models.LedgerGroup, models.Ledger, models.AuditLog];

  for (const model of modelList) {
    await model.createCollection();
    await model.createIndexes();
  }
};

const seedAccounting = async ({ connection, models, tenantId }) => {
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
};

const getMainCounts = async ({ mainConnection, models, tenantId }) => {
  const counts = {};

  for (const [key, model] of Object.entries(models)) {
    counts[key] = await mainConnection.db
      .collection(model.collection.name)
      .countDocuments({
        tenantId,
      });
  }

  return counts;
};

const verifySeededRecords = async ({ models, tenantId }) => {
  const groups = await models.LedgerGroup.find({ tenantId })
    .select("code")
    .lean();

  const ledgers = await models.Ledger.find({ tenantId })
    .populate("ledgerGroupId", "code name")
    .lean();

  assert.equal(
    groups.length,
    DEFAULT_LEDGER_GROUPS.length,
    "Unexpected number of ledger groups",
  );

  assert.equal(
    ledgers.length,
    DEFAULT_LEDGERS.length,
    "Unexpected number of ledgers",
  );

  assert.deepEqual(
    groups.map((group) => group.code).sort(),

    DEFAULT_LEDGER_GROUPS.map((group) => group.code).sort(),

    "Ledger group codes do not match",
  );

  assert.deepEqual(
    ledgers.map((ledger) => ledger.code).sort(),

    DEFAULT_LEDGERS.map((ledger) => ledger.code).sort(),

    "Ledger codes do not match",
  );

  const expectedByCode = new Map(
    DEFAULT_LEDGERS.map((ledger) => [ledger.code, ledger]),
  );

  for (const ledger of ledgers) {
    const expected = expectedByCode.get(ledger.code);

    assert.equal(
      String(ledger.tenantId),
      String(tenantId),
      `Incorrect tenant for ${ledger.code}`,
    );

    assert.equal(
      ledger.ledgerGroupId?.code,
      expected.groupCode,
      `Incorrect group for ${ledger.code}`,
    );

    assert.equal(
      ledger.openingBalance,
      0,
      `Unexpected opening balance for ${ledger.code}`,
    );

    assert.equal(
      ledger.currentBalance,
      0,
      `Unexpected current balance for ${ledger.code}`,
    );

    assert.equal(
      ledger.isSystem,
      true,
      `Expected a system ledger: ${ledger.code}`,
    );

    assert.equal(
      ledger.isActive,
      true,
      `Expected an active ledger: ${ledger.code}`,
    );
  }

  /*
    Compare record IDs as well as counts to verify
    that repeated seeding preserves existing records.
  */
  return {
    groups: groups.length,
    ledgers: ledgers.length,

    groupIds: groups.map((group) => String(group._id)).sort(),

    ledgerIds: ledgers.map((ledger) => String(ledger._id)).sort(),
  };
};

let testDatabaseName = null;
let databaseWritesStarted = false;

const run = async () => {
  const { uri, expectedMainDb } = validateConfiguration();

  const tenantId = new mongoose.Types.ObjectId();

  /*
    5 characters ("test_") + 12 hex characters = 17.
    Full database name is 32 ASCII bytes.
  */
  const databaseKey = `test_${randomBytes(6).toString("hex")}`;

  const databaseName = getTenantDatabaseName(databaseKey);

  testDatabaseName = databaseName;

  assert.ok(
    databaseKey.length <= 23,
    "Generated database key exceeds 23 characters",
  );

  assert.ok(
    Buffer.byteLength(databaseName, "utf8") <= 38,
    "Generated database name exceeds 38 bytes",
  );

  console.log("Generated database key:", databaseKey);

  console.log("Database key length:", databaseKey.length);

  console.log("Development test target:", databaseName);

  console.log("No existing tenant record will be created or updated.");

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });

  const mainConnection = mongoose.connection;

  console.log("Connected database:", mainConnection.name);

  console.log("Expected database:", expectedMainDb);

  assert.equal(
    mainConnection.name,
    expectedMainDb,
    "Connected database does not match the expected test database",
  );

  // Enabled only in this standalone test process.
  process.env.TENANT_DATABASES_ENABLED = "true";

  // In-memory fixture; never saved to the Tenant collection.
  const tenant = {
    _id: tenantId,

    businessName: "Accounting Provisioning Test",

    databaseKey,
    databaseName,

    storageMode: "DEDICATED",
    provisioningStatus: "PROVISIONING",

    isActive: true,
    status: "active",
  };

  const connection = getProvisioningConnection(tenant);

  assert.equal(
    connection.name,
    databaseName,
    "Incorrect tenant database selected",
  );

  assert.notEqual(
    connection.name,
    mainConnection.name,
    "Tenant database must differ from the main database",
  );

  const models = getTenantAccountingModels(connection);

  for (const model of Object.values(models)) {
    assert.equal(
      model.db,
      connection,
      "Model is bound to the wrong connection",
    );
  }

  /*
    Refuse to reuse an existing target database.
    The random target should be new.
  */
  const existingCollections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  assert.equal(
    existingCollections.length,
    0,
    "Test target already contains collections; refusing to seed it",
  );

  const before = await getMainCounts({
    mainConnection,
    models,
    tenantId,
  });

  for (const count of Object.values(before)) {
    assert.equal(
      count,
      0,
      "Unexpected test records already exist in the main database",
    );
  }

  databaseWritesStarted = true;

  await createCollectionsAndIndexes(models);

  console.log("Test collections and indexes created");

  await seedAccounting({
    connection,
    models,
    tenantId,
  });

  const first = await verifySeededRecords({
    models,
    tenantId,
  });

  console.log(
    `First seed OK: ${first.groups} groups, ${first.ledgers} ledgers`,
  );

  await seedAccounting({
    connection,
    models,
    tenantId,
  });

  const second = await verifySeededRecords({
    models,
    tenantId,
  });

  assert.deepEqual(
    second,
    first,
    "Repeated seeding changed record counts or IDs",
  );

  const after = await getMainCounts({
    mainConnection,
    models,
    tenantId,
  });

  assert.deepEqual(
    after,
    before,
    "Test accounting records were written into the main database",
  );

  console.log("Repeated seed OK: no duplicates; record IDs unchanged");

  console.log("Ledger-group population OK");

  console.log("No test accounting records found in the main database");

  console.log("Accounting provisioning test PASSED");

  console.log("Test database retained for inspection:", databaseName);

  console.log("No tenant was marked READY. No API routing was changed.");
};

run()
  .catch((error) => {
    console.error("Accounting provisioning test FAILED:", error.message);

    if (databaseWritesStarted && testDatabaseName) {
      console.error("A partial test database may remain:", testDatabaseName);
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Database disconnect failed:", error.message);

      process.exitCode = 1;
    }
  });
