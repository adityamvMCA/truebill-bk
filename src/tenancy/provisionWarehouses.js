const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("./tenantAccountingModels");

const DEFAULT_WAREHOUSE_CODE = "MAIN";

const WAREHOUSE_COLLECTION = "warehouses";

const INVENTORY_SETTINGS_COLLECTION =
  "inventorysettings";

const WAREHOUSE_STOCK_COLLECTION =
  "warehousestocks";

const ensureConnection = (connection) => {
  if (
    !connection ||
    typeof connection.model !== "function" ||
    !connection.models
  ) {
    throw new Error(
      "A valid Mongoose connection is required",
    );
  }

  if (connection.readyState !== 1) {
    throw new Error(
      "The database connection is not ready",
    );
  }
};

const ensureCollection = async (
  connection,
  collectionName,
) => {
  const db = connection.db;

  const exists = await db
    .listCollections({
      name: collectionName,
    })
    .hasNext();

  if (exists) {
    return;
  }

  await db.createCollection(
    collectionName,
  );
};

const ensureIndexes = async (models) => {
  await models.Warehouse.createIndexes();

  await models.InventorySettings.createIndexes();

  await models.WarehouseStock.createIndexes();
};

const provisionWarehousesForTenant =
  async ({
    tenant,
    userId,
    connection,
  }) => {
    if (
      !tenant ||
      typeof tenant !== "object" ||
      !tenant._id
    ) {
      throw new Error(
        "A valid tenant context is required",
      );
    }

    if (
      !userId ||
      typeof userId !== "string"
    ) {
      throw new Error(
        "A valid authenticated user ID is required",
      );
    }

    ensureConnection(connection);

    const models =
      getTenantAccountingModels(
        connection,
      );

    await ensureCollection(
      connection,
      WAREHOUSE_COLLECTION,
    );

    await ensureCollection(
      connection,
      INVENTORY_SETTINGS_COLLECTION,
    );

    await ensureCollection(
      connection,
      WAREHOUSE_STOCK_COLLECTION,
    );

    await ensureIndexes(models);

    const session =
      await connection.startSession();

    let result;

    try {
      await session.withTransaction(
        async () => {
          const existingSettings =
            await models.InventorySettings.findOne(
              {
                tenantId: tenant._id,
              },
              null,
              {
                session,
              },
            );

          if (existingSettings) {
            result = {
              alreadyProvisioned: true,
              settings: existingSettings,
            };

            return;
          }

          const existingMain =
            await models.Warehouse.findOne(
              {
                tenantId: tenant._id,
                warehouseCode:
                  DEFAULT_WAREHOUSE_CODE,
              },
              null,
              {
                session,
              },
            );

          if (existingMain) {
            throw new Error(
              "Warehouse setup is incomplete: MAIN exists but InventorySettings is missing",
            );
          }

          const now = new Date();

          const [mainWarehouse] =
            await models.Warehouse.create(
              [
                {
                  tenantId: tenant._id,
                  warehouseCode:
                    DEFAULT_WAREHOUSE_CODE,
                  name: "Main Location",
                  description:
                    "System-created default inventory location",
                  address: null,
                  status: "ACTIVE",
                  isSystem: true,
                  createdBy: userId,
                  updatedBy: userId,
                },
              ],
              {
                session,
              },
            );

          const [settings] =
            await models.InventorySettings.create(
              [
                {
                  tenantId: tenant._id,
                  defaultWarehouseId:
                    mainWarehouse._id,
                  multiWarehouseEnabled:
                    false,
                  warehouseTrackingStatus:
                    "NOT_INITIALIZED",
                  warehouseTrackingStartedAt:
                    null,
                  createdBy: userId,
                  updatedBy: userId,
                },
              ],
              {
                session,
              },
            );

          result = {
            alreadyProvisioned: false,
            warehouse: mainWarehouse,
            settings,
          };
        },
        {
          session,
        },
      );
    } finally {
      await session.endSession();
    }

    return result;
  };

module.exports = {
  provisionWarehousesForTenant,
};