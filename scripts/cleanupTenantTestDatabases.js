const path = require("path");
const mongoose = require("mongoose");

const envResult = require("dotenv").config({
  path: path.resolve(__dirname, "../.env.tenant-test"),
  quiet: true,
});

const validateConfiguration = () => {
  if (!process.argv.includes("--run")) {
    throw new Error(
      "Explicit --run argument is required.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "This cleanup script must not run in production mode.",
    );
  }

  if (envResult.error) {
    throw new Error(
      "Could not load .env.tenant-test.",
    );
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
    throw new Error(
      "A valid TENANT_TEST_MONGO_URI is required.",
    );
  }

  if (
    !expectedMainDb ||
    !/^truebill_test_[a-z0-9_]+$/.test(expectedMainDb)
  ) {
    throw new Error(
      "Expected main database must start with truebill_test_.",
    );
  }

  return { uri, expectedMainDb };
};

const run = async () => {
  const { uri, expectedMainDb } =
    validateConfiguration();

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });

  assertMainDatabase(expectedMainDb);

  const admin = mongoose.connection.db.admin();

  const databases = await admin
    .listDatabases()
    .then((result) => result.databases || []);

  const testDatabases = databases
    .map((database) => database.name)
    .filter((name) =>
      /^trustiq_tenant_test_[a-z0-9]+$/.test(name),
    );

  console.log(
    `Found ${testDatabases.length} retained tenant test databases.`,
  );

  for (const name of testDatabases) {
    await mongoose.connection.useDb(name, {
      useCache: false,
    }).db.dropDatabase();

    console.log(`Dropped: ${name}`);
  }

  console.log("Tenant test database cleanup complete.");
};

const assertMainDatabase = (expectedMainDb) => {
  if (mongoose.connection.name !== expectedMainDb) {
    throw new Error(
      `Connected database ${mongoose.connection.name} does not match expected ${expectedMainDb}.`,
    );
  }
};

run()
  .catch((error) => {
    console.error(
      "Tenant test database cleanup FAILED:",
      error.stack || error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
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