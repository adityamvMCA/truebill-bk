const { getReadyTenantConnection } = require("./tenantConnectionManager");

const { getTenantAccountingModels } = require("./tenantAccountingModels");

const {
  seedDefaultWarehouse,
} = require("../modules/warehouses/warehouse.seed");

const ensureCollection = async (connection, model) => {
  const collectionName = model.collection.name;

  const existing = await connection.db
    .listCollections(
      {
        name: collectionName,
      },
      {
        nameOnly: true,
      },
    )
    .toArray();

  if (existing.length === 0) {
    try {
      await model.createCollection();
    } catch (error) {
      if (error.code !== 48 && error.codeName !== "NamespaceExists") {
        throw error;
      }
    }
  }

  await model.createIndexes();
};

const provisionWarehousesForTenant = async ({ tenant, userId = null }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  if (tenant.databaseName && connection.name !== tenant.databaseName) {
    throw new Error("Invalid tenant database target");
  }

  for (const name of ["Warehouse", "InventorySettings", "WarehouseStock"]) {
    const model = models[name];

    if (!model || model.db !== connection) {
      throw new Error(`Invalid tenant model: ${name}`);
    }

    await ensureCollection(connection, model);
  }

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await seedDefaultWarehouse({
        models,
        tenantId: tenant._id,
        userId,
        session,
      });
    });

    return {
      databaseName: connection.name,
      ...result,
    };
  } finally {
    await session.endSession();
  }
};

module.exports = {
  provisionWarehousesForTenant,
};
