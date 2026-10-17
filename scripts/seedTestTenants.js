require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");

const Tenant = require("../src/models/Tenant");
const User = require("../src/models/User");

const {
  createTenant,
} = require("../src/controllers/tenantController");

const TEST_TENANTS = [
  {
    businessName: "Test Trader One",
    businessType: "Trader",
    email: "tenant1@test.com",
    phone: "9876543210",
    address: "Test Address 1",
    city: "Belagavi",
    state: "Karnataka",
    pincode: "590001",
    subscriptionPlan: "basic",
    adminName: "Test Admin One",
    adminEmail: "test1@gmail.com",
    adminPassword: "123456",
  },
  {
    businessName: "Test Trader Two",
    businessType: "Trader",
    email: "tenant2@test.com",
    phone: "9876543211",
    address: "Test Address 2",
    city: "Belagavi",
    state: "Karnataka",
    pincode: "590001",
    subscriptionPlan: "standard",
    adminName: "Test Admin Two",
    adminEmail: "test2@gmail.com",
    adminPassword: "123456",
  },
  {
    businessName: "Test Trader Three",
    businessType: "Trader",
    email: "tenant3@test.com",
    phone: "9876543212",
    address: "Test Address 3",
    city: "Belagavi",
    state: "Karnataka",
    pincode: "590001",
    subscriptionPlan: "premium",
    adminName: "Test Admin Three",
    adminEmail: "test3@gmail.com",
    adminPassword: "123456",
  },
];

const validateConfiguration = () => {
  if (!process.argv.includes("--run")) {
    throw new Error(
      "Explicit --run argument is required.",
    );
  }

  const environment = String(
    process.env.NODE_ENV || "",
  )
    .trim()
    .toLowerCase();

  if (environment === "production") {
    throw new Error(
      "Test tenant seeding is blocked in production.",
    );
  }

  const uri = process.env.MONGO_URI?.trim();

  if (
    !uri ||
    (
      !uri.startsWith("mongodb://") &&
      !uri.startsWith("mongodb+srv://")
    )
  ) {
    throw new Error(
      "A valid MONGO_URI is required.",
    );
  }

  const expectedMainDb =
    process.env.SEED_EXPECTED_MAIN_DB?.trim();

  if (
    !expectedMainDb ||
    ["admin", "config", "local"].includes(
      expectedMainDb,
    )
  ) {
    throw new Error(
      "SEED_EXPECTED_MAIN_DB must identify your intended non-production main database.",
    );
  }

  if (
    process.env.TENANT_DATABASES_ENABLED !== "true"
  ) {
    throw new Error(
      "TENANT_DATABASES_ENABLED must be true.",
    );
  }

  return {
    uri,
    expectedMainDb,
  };
};

const createThroughController = async (payload) => {
  let statusCode = 200;
  let responseBody;
  let responded = false;

  const req = {
    body: payload,
    user: {
      userId: null,
    },
    ip: "127.0.0.1",
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },

    json(body) {
      responseBody = body;
      responded = true;
      return this;
    },
  };

  await createTenant(req, res);

  if (!responded) {
    throw new Error(
      "createTenant did not return a response.",
    );
  }

  if (
    statusCode !== 201 ||
    responseBody?.success !== true
  ) {
    const error = new Error(
      responseBody?.message ||
        `Tenant creation failed with status ${statusCode}`,
    );

    error.tenantId = responseBody?.tenantId;

    throw error;
  }

  const tenant = responseBody.tenant;
  const admin = responseBody.admin;

  if (
    tenant?.storageMode !== "DEDICATED" ||
    tenant?.provisioningStatus !== "READY" ||
    !tenant?.databaseName ||
    !tenant?.databaseKey ||
    !tenant?.provisionedAt ||
    tenant?.databaseSchemaVersion < 1
  ) {
    throw new Error(
      "Tenant was created without completed dedicated provisioning. Verify that the corrected createTenant controller is installed.",
    );
  }

  if (
    admin?.isActive !== true ||
    String(admin.tenantId) !== String(tenant._id)
  ) {
    throw new Error(
      "Tenant administrator was not activated correctly.",
    );
  }

  return {
    tenant,
    admin,
  };
};

const seedTestTenants = async () => {
  const {
    uri,
    expectedMainDb,
  } = validateConfiguration();

  console.log("Connecting to MongoDB...");

  await mongoose.connect(uri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 15000,
  });

  if (
    mongoose.connection.name !== expectedMainDb
  ) {
    throw new Error(
      `Connected to "${mongoose.connection.name}", but expected "${expectedMainDb}". No tenants were seeded.`,
    );
  }

  console.log(
    `Connected main database: ${mongoose.connection.name}`,
  );

  console.log(
    "Test-only seed: all new demo admins use the password defined in this file.",
  );

  await Tenant.init();
  await User.init();

  await Tenant.createIndexes();
  await User.createIndexes();

  let createdTenants = 0;
  let skippedTenants = 0;

  for (const details of TEST_TENANTS) {
    const normalizedAdminEmail = details.adminEmail
      .trim()
      .toLowerCase();

    const normalizedBusinessEmail = details.email
      .trim()
      .toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedAdminEmail,
    })
      .select("_id tenantId")
      .lean();

    const existingTenant = await Tenant.findOne({
      email: normalizedBusinessEmail,
    })
      .select(
        "clientCode storageMode provisioningStatus databaseName",
      )
      .lean();

    if (existingUser || existingTenant) {
      console.log(
        `SKIPPED: ${details.businessName}`,
      );

      if (existingUser) {
        console.log(
          `  Admin email already exists: ${normalizedAdminEmail}`,
        );
      }

      if (existingTenant) {
        console.log(
          `  Existing tenant: ${existingTenant.clientCode}`,
        );

        console.log(
          `  Storage: ${existingTenant.storageMode || "LEGACY"}`,
        );

        console.log(
          `  Provisioning: ${existingTenant.provisioningStatus || "LEGACY"}`,
        );

        if (existingTenant.databaseName) {
          console.log(
            `  Database: ${existingTenant.databaseName}`,
          );
        }
      }

      console.log(
        "  Existing records and passwords were not changed.",
      );

      console.log(
        "  Existing LEGACY tenants were not migrated.",
      );

      console.log("");

      skippedTenants += 1;
      continue;
    }

    const {
      tenant,
      admin,
    } = await createThroughController({
      ...details,
      email: normalizedBusinessEmail,
      adminEmail: normalizedAdminEmail,
    });

    createdTenants += 1;

    console.log(
      `CREATED: ${tenant.businessName}`,
    );

    console.log(
      `  Client code: ${tenant.clientCode}`,
    );

    console.log(
      `  Tenant ID: ${tenant._id}`,
    );

    console.log(
      `  Database key: ${tenant.databaseKey}`,
    );

    console.log(
      `  Database: ${tenant.databaseName}`,
    );

    console.log(
      `  Storage: ${tenant.storageMode}`,
    );

    console.log(
      `  Provisioning: ${tenant.provisioningStatus}`,
    );

    console.log(
      `  Schema version: ${tenant.databaseSchemaVersion}`,
    );

    console.log(
      `  Plan: ${tenant.subscriptionPlan}`,
    );

    console.log(
      `  Admin: ${admin.email}`,
    );

    console.log(
      `  Admin active: ${admin.isActive}`,
    );

    console.log(
      `  Expires: ${new Date(
        tenant.subscriptionEnd,
      ).toISOString()}`,
    );

    console.log("");
  }

  console.log("Test tenant seeding completed.");

  console.log(
    `Created: ${createdTenants}`,
  );

  console.log(
    `Skipped: ${skippedTenants}`,
  );
};

seedTestTenants()
  .catch((error) => {
    console.error(
      "Test tenant seeding FAILED:",
      error.message,
    );

    if (error.tenantId) {
      console.error(
        `Inspect tenant ${error.tenantId} before retrying. Registration may already exist.`,
      );
    }

    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error(
        "MongoDB disconnect failed:",
        error.message,
      );

      process.exitCode = 1;
    }
  });
////node scripts/seedTestTenants.js