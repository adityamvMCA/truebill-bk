require("dotenv").config();

const mongoose = require("mongoose");

const Tenant = require(
  "../models/Tenant",
);

const {
  getTenantAccountingModels,
} = require(
  "../tenancy/tenantAccountingModels",
);

const {
  getReadyTenantConnection,
} = require(
  "../tenancy/tenantConnectionManager",
);

const SALES_QUOTATION_INDEXES = [
  {
    key: {
      tenantId: 1,
      quotationNumber: 1,
      revision: 1,
    },
    name: "tenantId_1_quotationNumber_1_revision_1",
    unique: true,
  },
  {
    key: {
      tenantId: 1,
      quotationFamilyId: 1,
      revision: 1,
    },
    name: "tenantId_1_quotationFamilyId_1_revision_1",
    unique: true,
  },
  {
    key: {
      tenantId: 1,
      isDeleted: 1,
      status: 1,
      quotationDate: -1,
    },
    name: "tenantId_1_isDeleted_1_status_1_quotationDate_-1",
  },
  {
    key: {
      tenantId: 1,
      customerId: 1,
      quotationDate: -1,
    },
    name: "tenantId_1_customerId_1_quotationDate_-1",
  },
  {
    key: {
      tenantId: 1,
      comparisonGroupId: 1,
      customerId: 1,
    },
    name: "tenantId_1_comparisonGroupId_1_customerId_1",
  },
  {
    key: {
      tenantId: 1,
      status: 1,
      validUntil: 1,
    },
    name: "tenantId_1_status_1_validUntil_1",
  },
];

const COLLECTION_NAME = "salesquotations";

const createCollectionIfMissing = async (
  database,
) => {
  const collections =
    await database
      .listCollections({
        name: COLLECTION_NAME,
      })
      .toArray();

  if (collections.length > 0) {
    return false;
  }

  await database.createCollection(
    COLLECTION_NAME,
  );

  return true;
};

const createIndexesIfMissing = async (
  database,
) => {
  const collection = database.collection(
    COLLECTION_NAME,
  );

  const existingIndexes =
    await collection.indexes();

  const existingByName = new Map(
    existingIndexes.map((index) => [
      index.name,
      index,
    ]),
  );

  const created = [];

  for (const index of SALES_QUOTATION_INDEXES) {
    if (existingByName.has(index.name)) {
      continue;
    }

    await collection.createIndex(
      index.key,
      {
        name: index.name,
        unique: index.unique ?? false,
        background: true,
      },
    );

    created.push(index.name);
  }

  return created;
};

const upgradeTenant = async (tenant) => {
  const connection =
    getReadyTenantConnection(tenant);

  // Registers the SalesQuotation model on this
  // tenant connection and validates the registry.
  getTenantAccountingModels(connection);

  const database = connection.db;

  const collectionCreated =
    await createCollectionIfMissing(database);

  const indexesCreated =
    await createIndexesIfMissing(database);

  return {
    tenantId: String(tenant._id ?? tenant.id),
    clientCode: tenant.clientCode,
    collectionCreated,
    indexesCreated,
  };
};

const runUpgrade = async () => {
  if (!process.env.MONGOURI) {
    throw new Error(
      "MONGOURI is missing in .env",
    );
  }

  await mongoose.connect(
    process.env.MONGOURI,
  );

  const tenants = await Tenant.find({
    isActive: true,
  })
    .select("_id clientCode")
    .lean();

  const results = [];
  const failures = [];

  for (const tenant of tenants) {
    try {
      const result =
        await upgradeTenant(tenant);

      results.push(result);

      console.log(
        `Upgraded tenant ${result.clientCode}: ` +
          `collectionCreated=${result.collectionCreated}, ` +
          `indexesCreated=${result.indexesCreated.length}`,
      );
    } catch (error) {
      failures.push({
        tenantId: String(
          tenant._id ?? tenant.id,
        ),
        clientCode: tenant.clientCode,
        message: error.message,
      });

      console.error(
        `Failed to upgrade tenant ${tenant.clientCode}:`,
        error.message,
      );
    }
  }

  await mongoose.disconnect();

  return {
    total: tenants.length,
    upgraded: results.length,
    failed: failures.length,
    results,
    failures,
  };
};

if (require.main === module) {
  runUpgrade()
    .then((summary) => {
      console.log(
        JSON.stringify(summary, null, 2),
      );

      if (summary.failed > 0) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(
        "Sales quotation schema upgrade failed:",
        error,
      );

      process.exitCode = 1;
    });
}

module.exports = {
  runUpgrade,
  upgradeTenant,
  SALES_QUOTATION_INDEXES,
};