const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");

const envResult = require("dotenv").config({
  path: path.resolve(
    __dirname,
    "../.env.tenant-test",
  ),
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

const {
  postJournal,
} = require(
  "../src/modules/accounting/journals/journal.service",
);

const createdDatabases = [];

const validateConfiguration = () => {
  if (!process.argv.includes("--run")) {
    throw new Error(
      "Explicit --run argument is required.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "This test must not run in production mode.",
    );
  }

  if (envResult.error) {
    throw new Error(
      "Could not load .env.tenant-test.",
    );
  }

  const settings = envResult.parsed || {};

  const uri =
    settings.TENANT_TEST_MONGO_URI?.trim();

  const expectedMainDb =
    settings.TENANT_TEST_EXPECTED_MAIN_DB?.trim();

  if (
    !uri ||
    (
      !uri.startsWith("mongodb://") &&
      !uri.startsWith("mongodb+srv://")
    )
  ) {
    throw new Error(
      "A valid TENANT_TEST_MONGO_URI is required.",
    );
  }

  if (
    !expectedMainDb ||
    !/^truebill_test_[a-z0-9_]+$/.test(
      expectedMainDb,
    ) ||
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
  const tenantId =
    new mongoose.Types.ObjectId();

  const databaseKey =
    `test_${randomBytes(6).toString("hex")}`;

  const databaseName =
    getTenantDatabaseName(databaseKey);

  const tenant = {
    _id: tenantId,
    businessName: `Journal Test ${label}`,
    databaseKey,
    databaseName,
    storageMode: "DEDICATED",
    provisioningStatus: "PROVISIONING",
    isActive: true,
    status: "active",
  };

  const connection =
    getProvisioningConnection(tenant);

  const models =
    getTenantAccountingModels(connection);

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
  const {
    tenantId,
    databaseName,
    connection,
    models,
  } = context;

  const collections = await connection.db
    .listCollections(
      {},
      { nameOnly: true },
    )
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
    models.Journal,
  ]) {
    assert.equal(
      model.db,
      connection,
      "Model has the wrong connection",
    );

    await model.createCollection();
    await model.createIndexes();
  }

  const session =
    await connection.startSession();

  try {
    await session.withTransaction(
      async () => {
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
      },
    );
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

  console.log(
    `${context.label} provisioned: ${databaseName}`,
  );
};

const getReadyTenant = (context) => ({
  ...context.tenant,
  provisioningStatus: "READY",
});

const findLedgerByCode = async (
  context,
  code,
) => {
  const ledger =
    await context.models.Ledger.findOne({
      tenantId: context.tenantId,
      code,
    })
      .lean();

  assert.ok(
    ledger,
    `Ledger ${code} was not found`,
  );

  return ledger;
};

const postTestJournal = async (
  context,
  sourceId,
) => {
  const tenant =
    getReadyTenant(context);

  const connection = context.connection;

  const session =
    await connection.startSession();

  try {
    let journal;

    await session.withTransaction(
      async () => {
        const cash =
          await findLedgerByCode(
            context,
            "CASH",
          );

        const sales =
          await findLedgerByCode(
            context,
            "SALES",
          );

        journal = await postJournal({
          tenant,
          connection,
          userId: context.tenantId,
          postingDate: new Date(),
          sourceType: "MANUAL_JOURNAL",
          sourceId,
          sourceNumber:
            `MANUAL-${sourceId.toString()}`,
          narration:
            "Tenant journal posting test",
          lines: [
            {
              ledgerId: cash._id,
              debitPaise: 100000,
              creditPaise: 0,
              narration: "Cash received",
            },
            {
              ledgerId: sales._id,
              debitPaise: 0,
              creditPaise: 100000,
              narration: "Sales recorded",
            },
          ],
          session,
        });
      },
    );

    assert.ok(journal);
    assert.ok(journal.journalNumber);

    assert.equal(
      journal.totalDebitPaise,
      100000,
    );

    assert.equal(
      journal.totalCreditPaise,
      100000,
    );

    const cash =
      await findLedgerByCode(
        context,
        "CASH",
      );

    const sales =
      await findLedgerByCode(
        context,
        "SALES",
      );

    assert.equal(
      cash.currentBalance,
      1000,
    );

    assert.equal(
      cash.currentBalanceType,
      "DEBIT",
    );

    assert.equal(
      sales.currentBalance,
      1000,
    );

    assert.equal(
      sales.currentBalanceType,
      "CREDIT",
    );

    console.log(
      "PASS: journal posted and ledger balances updated",
    );

    return journal;
  } finally {
    await session.endSession();
  }
};

const verifyDuplicateSource = async (
  context,
  sourceId,
) => {
  const tenant =
    getReadyTenant(context);

  const connection = context.connection;

  const session =
    await connection.startSession();

  try {
    await session.withTransaction(
      async () => {
        await postJournal({
          tenant,
          connection,
          userId: context.tenantId,
          postingDate: new Date(),
          sourceType: "MANUAL_JOURNAL",
          sourceId,
          sourceNumber:
            `MANUAL-${sourceId.toString()}`,
          narration:
            "Duplicate journal attempt",
          lines: [
            {
              ledgerId:
                new mongoose.Types.ObjectId(),
              debitPaise: 100,
              creditPaise: 0,
            },
            {
              ledgerId:
                new mongoose.Types.ObjectId(),
              debitPaise: 0,
              creditPaise: 100,
            },
          ],
          session,
        });
      },
    );

    assert.fail(
      "Expected duplicate source journal to fail",
    );
  } catch (error) {
    assert.match(
      error.message,
      /already posted/i,
    );
  } finally {
    await session.endSession();
  }

  console.log(
    "PASS: duplicate source journal was rejected",
  );
};

const verifyRollback = async (context) => {
  const tenant =
    getReadyTenant(context);

  const connection = context.connection;

  const cashBefore =
    await findLedgerByCode(
      context,
      "CASH",
    );

  const salesBefore =
    await findLedgerByCode(
      context,
      "SALES",
    );

  const journalsBefore =
    await context.models.Journal.countDocuments(
      {},
    );

  const session =
    await connection.startSession();

  let forcedFailure = false;

  try {
    await session.withTransaction(
      async () => {
        const cash =
          await context.models.Ledger
            .findOne({
              tenantId: context.tenantId,
              code: "CASH",
            })
            .session(session);

        const sales =
          await context.models.Ledger
            .findOne({
              tenantId: context.tenantId,
              code: "SALES",
            })
            .session(session);

        await postJournal({
          tenant,
          connection,
          userId: context.tenantId,
          postingDate: new Date(),
          sourceType: "MANUAL_JOURNAL",
          sourceId:
            new mongoose.Types.ObjectId(),
          sourceNumber:
            `MANUAL-${randomBytes(6).toString("hex")}`,
          narration:
            "Rollback journal attempt",
          lines: [
            {
              ledgerId: cash._id,
              debitPaise: 25000,
              creditPaise: 0,
            },
            {
              ledgerId: sales._id,
              debitPaise: 0,
              creditPaise: 25000,
            },
          ],
          session,
        });

        forcedFailure = true;

        throw new Error(
          "Intentional journal rollback failure",
        );
      },
    );
  } catch (error) {
    assert.equal(
      error.message,
      "Intentional journal rollback failure",
    );
  } finally {
    await session.endSession();
  }

  assert.equal(forcedFailure, true);

  const cashAfter =
    await findLedgerByCode(
      context,
      "CASH",
    );

  const salesAfter =
    await findLedgerByCode(
      context,
      "SALES",
    );

  assert.equal(
    cashAfter.currentBalance,
    cashBefore.currentBalance,
  );

  assert.equal(
    cashAfter.currentBalanceType,
    cashBefore.currentBalanceType,
  );

  assert.equal(
    salesAfter.currentBalance,
    salesBefore.currentBalance,
  );

  assert.equal(
    salesAfter.currentBalanceType,
    salesBefore.currentBalanceType,
  );

  assert.equal(
    await context.models.Journal.countDocuments(
      {},
    ),
    journalsBefore,
  );

  console.log(
    "PASS: forced failure rolled back journal and ledger balances",
  );
};

const verifyTenantBUnchanged = async (
  context,
) => {
  assert.equal(
    await context.models.Journal.countDocuments(
      {},
    ),
    0,
  );

  const cash =
    await findLedgerByCode(
      context,
      "CASH",
    );

  assert.equal(
    cash.currentBalance,
    0,
  );

  console.log(
    "PASS: Tenant B remained unchanged",
  );
};

const verifyMainDatabase = async (
  contexts,
) => {
  const tenantIds = contexts.map(
    (context) => context.tenantId,
  );

  const collectionNames = [
    "accountingjournals",
    "accountingledgers",
    "ledgergroups",
    "auditlogs",
    "banks",
  ];

  for (const collectionName of collectionNames) {
    const count =
      await mongoose.connection.db
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

  console.log(
    "PASS: no test records found in main database",
  );
};

const run = async () => {
  const {
    uri,
    expectedMainDb,
  } = validateConfiguration();

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

  process.env.TENANT_DATABASES_ENABLED =
    "true";

  const contextA =
    createTenantContext("Tenant A");

  const contextB =
    createTenantContext("Tenant B");

  await provisionTenant(contextA);
  await provisionTenant(contextB);

  const sourceId =
    new mongoose.Types.ObjectId();

  await postTestJournal(
    contextA,
    sourceId,
  );

  await verifyDuplicateSource(
    contextA,
    sourceId,
  );

  await verifyRollback(contextA);

  await verifyTenantBUnchanged(contextB);

  await verifyMainDatabase([
    contextA,
    contextB,
  ]);

  console.log(
    "Tenant journal posting test PASSED",
  );

  console.log(
    "No Tenant record was saved or marked READY.",
  );

  console.log(
    "No API routing was changed.",
  );
};

run()
  .catch((error) => {
    console.error(
      "Tenant journal test FAILED:",
      error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdDatabases.length) {
      console.log(
        "Test databases retained for inspection:",
      );

      for (const databaseName of createdDatabases) {
        console.log(`- ${databaseName}`);
      }
    }

    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error(
        "Disconnect failed:",
        error.message,
      );

      process.exitCode = 1;
    }
  });