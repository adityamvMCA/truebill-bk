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

const bankService = require("../src/modules/banks/bank.service");

const createdDatabases = [];

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

  return {
    uri,
    expectedMainDb,
  };
};

const createTenantContext = (label) => {
  const tenantId = new mongoose.Types.ObjectId();

  const databaseKey = `test_${randomBytes(6).toString("hex")}`;

  const databaseName = getTenantDatabaseName(databaseKey);

  const tenant = {
    _id: tenantId,
    businessName: `Bank Test ${label}`,
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
    tenant,
    tenantId,
    databaseName,
    connection,
    models,
  };
};

const provisionTenant = async (context) => {
  const { tenant, tenantId, databaseName, connection, models } = context;

  const collections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  assert.equal(
    collections.length,
    0,
    "Refusing to reuse an existing test database",
  );

  createdDatabases.push(databaseName);

  for (const model of [
    models.LedgerGroup,
    models.Ledger,
    models.AuditLog,
    models.Bank,
  ]) {
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

const getReadyTenant = (context) => ({
  ...context.tenant,
  provisioningStatus: "READY",
});

const createTestBank = async (context) => {
  const tenant = getReadyTenant(context);

  const bank = await bankService.createBank({
    tenant,
    userId: context.tenantId,
    payload: {
      accountName: "Test Current Account",
      bankName: "Test Bank",
      accountHolderName: "Test Business",
      accountNumber: "1234567890",
      accountType: "CURRENT",
      branchName: "Test Branch",
      ifscCode: "TEST0123456",
      openingBalance: 1000,
      status: "ACTIVE",
      notes: "Created by tenant bank test",
    },
    ipAddress: "127.0.0.1",
  });

  assert.ok(bank);
  assert.ok(bank.bankCode);
  assert.ok(bank.ledgerId);

  const { Bank, Ledger, AuditLog } = context.models;

  const savedBank = await Bank.findOne({
    tenantId: context.tenantId,
    bankCode: bank.bankCode,
  }).lean();

  assert.ok(savedBank);

  const savedLedger = await Ledger.findOne({
    tenantId: context.tenantId,
    _id: bank.ledgerId,
    referenceType: "BANK",
    referenceId: savedBank._id,
  }).lean();

  assert.ok(savedLedger);

  const auditCount = await AuditLog.countDocuments({
    tenantId: context.tenantId,
    module: "BANK",
    action: "CREATE",
    documentId: savedBank._id,
  });

  assert.equal(auditCount, 1);

  console.log("PASS: Tenant A bank, linked ledger, and audit log created");

  return {
    bank,
    savedBank,
    savedLedger,
  };
};

const verifyTenantBUnchanged = async (contextB) => {
  const { Bank, Ledger, AuditLog } = contextB.models;

  assert.equal(await Bank.countDocuments({}), 0);

  assert.equal(
    await Ledger.countDocuments({
      type: "BANK",
    }),
    0,
  );

  assert.equal(
    await AuditLog.countDocuments({
      module: "BANK",
    }),
    0,
  );

  console.log("PASS: Tenant B remained unchanged");
};

const verifyRollback = async (context) => {
  const tenant = getReadyTenant(context);

  const payload = {
    accountName: "Rollback Current Account",
    bankName: "Rollback Bank",
    accountHolderName: "Rollback Business",
    accountNumber: "9876543210",
    accountType: "CURRENT",
    branchName: "Rollback Branch",
    ifscCode: "TEST0654321",
    openingBalance: 500,
    status: "ACTIVE",
  };

  const { Bank, Ledger, AuditLog } = context.models;

  const baselineAuditCount = await AuditLog.countDocuments({
    module: "BANK",
  });

  const originalLedgerCreate = Ledger.create.bind(Ledger);

  let forcedFailure = false;

  Ledger.create = async (documents, options) => {
    const result = await originalLedgerCreate(documents, options);

    forcedFailure = true;

    throw new Error("Intentional bank rollback failure");
  };

  try {
    await bankService.createBank({
      tenant,
      userId: context.tenantId,
      payload,
      ipAddress: "127.0.0.1",
    });

    assert.fail("Expected bank creation to fail");
  } catch (error) {
    assert.equal(error.message, "Intentional bank rollback failure");
  } finally {
    Ledger.create = originalLedgerCreate;
  }

  assert.equal(forcedFailure, true);

  assert.equal(
    await Bank.countDocuments({
      accountNumber: payload.accountNumber,
    }),
    0,
    "Bank was not rolled back",
  );

  assert.equal(
    await Ledger.countDocuments({
      name: payload.accountName,
    }),
    0,
    "Ledger was not rolled back",
  );

  assert.equal(
    await AuditLog.countDocuments({
      module: "BANK",
    }),
    baselineAuditCount,
    "Audit log was not rolled back",
  );

  console.log("PASS: forced failure rolled back bank and ledger");
};

const verifyMainDatabase = async (contexts) => {
  const tenantIds = contexts.map((context) => context.tenantId);

  const collectionNames = [
    "banks",
    "accountingledgers",
    "ledgergroups",
    "auditlogs",
  ];

  for (const collectionName of collectionNames) {
    const count = await mongoose.connection.db
      .collection(collectionName)
      .countDocuments({
        tenantId: {
          $in: tenantIds,
        },
      });

    assert.equal(
      count,
      0,
      `Test records found in main database collection: ${collectionName}`,
    );
  }

  console.log("PASS: no test records found in main database");
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
    "Connected database does not match expected test database",
  );

  console.log("Connected test main database:", mongoose.connection.name);

  process.env.TENANT_DATABASES_ENABLED = "true";

  const contextA = createTenantContext("Tenant A");

  const contextB = createTenantContext("Tenant B");

  await provisionTenant(contextA);
  await provisionTenant(contextB);

  await createTestBank(contextA);

  await verifyTenantBUnchanged(contextB);

  await verifyRollback(contextA);

  await verifyMainDatabase([contextA, contextB]);

  console.log("Tenant bank provisioning test PASSED");

  console.log("No Tenant record was saved or marked READY.");

  console.log("No API routing was changed.");
};

run()
  .catch((error) => {
    console.error("Tenant bank test FAILED:", error.message);

    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdDatabases.length) {
      console.log("Test databases retained for inspection:");

      for (const databaseName of createdDatabases) {
        console.log(`- ${databaseName}`);
      }
    }

    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error.message);

      process.exitCode = 1;
    }
  });
