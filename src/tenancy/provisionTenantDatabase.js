const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
  getProvisioningConnection,
} = require("./tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("./tenantAccountingModels");

const {
  DEFAULT_LEDGER_GROUPS,
  seedDefaultLedgerGroups,
} = require("../modules/accounting/seeds/seedDefaultLedgerGroups");

const {
  DEFAULT_LEDGERS,
  seedDefaultLedgers,
} = require("../modules/accounting/seeds/seedDefaultLedgers");

const {
  seedDefaultWarehouse,
} = require("../modules/Inventory/warehouses/seedDefaultWarehouse");

const MODEL_NAMES = [
  "LedgerGroup",
  "Ledger",
  "AuditLog",
  "Bank",
  "Journal",
  "PurchaseBill",
  "StockMovement",
  "Supplier",
  "Product",
  "SalesInvoice",
  "Customer",
  "CustomerReceipt",
  "SupplierPayment",
  "SalesQuotation",
  "DeliveryNote",
  "TaxConfiguration",
  "SupplierQuotation",
  "PurchaseOrder",
  "GoodsReceipt",
  "PurchaseReturn",
  "ProductCategory",
  "ProductUnit",
  "ProductBrand",
  "HsnSacCode",
  "TaxRate",
  "StockAdjustment",
  "Warehouse",
  "InventorySettings",
  "WarehouseStock",
];

const WAREHOUSE_MODEL_NAMES = [
  "Warehouse",
  "InventorySettings",
  "WarehouseStock",
];

const WAREHOUSE_COLLECTIONS = [
  "warehouses",
  "inventorysettings",
  "warehousestocks",
];

const assertTenant = (tenant) => {
  if (!tenant || typeof tenant !== "object" || !tenant._id) {
    throw new Error("A valid tenant context is required");
  }

  if (!tenant.databaseName || typeof tenant.databaseName !== "string") {
    throw new Error("Tenant databaseName is required");
  }

  return tenant;
};

const assertConnection = (connection) => {
  if (
    !connection ||
    typeof connection.model !== "function" ||
    !connection.models ||
    !connection.db
  ) {
    throw new Error("A valid Mongoose connection is required");
  }

  if (connection.readyState !== 1) {
    throw new Error("The database connection is not ready");
  }

  return connection;
};

const assertTenantConnection = ({ connection, tenant }) => {
  assertConnection(connection);

  if (connection.name !== tenant.databaseName) {
    throw new Error(
      "Tenant connection does not match tenant databaseName",
    );
  }

  return connection;
};

const assertModels = ({ models, connection, modelNames }) => {
  if (!models || typeof models !== "object") {
    throw new Error("Tenant models must be provided");
  }

  for (const name of modelNames) {
    const model = models[name];

    if (!model || model.db !== connection) {
      throw new Error(`Invalid tenant model: ${name}`);
    }
  }

  return models;
};

const ensureCollection = async (connection, collectionName) => {
  const exists = await connection.db
    .listCollections({ name: collectionName })
    .hasNext();

  if (exists) {
    return;
  }

  await connection.db.createCollection(collectionName);
};

const ensureWarehouseCollections = async (connection) => {
  for (const collectionName of WAREHOUSE_COLLECTIONS) {
    await ensureCollection(connection, collectionName);
  }
};

const ensureWarehouseIndexes = async (models) => {
  await models.Warehouse.createIndexes();
  await models.InventorySettings.createIndexes();
  await models.WarehouseStock.createIndexes();
};

const provisionTenantDatabase = async ({
  tenant,
  userId = null,
}) => {
  const validTenant = assertTenant(tenant);

  const connection = getProvisioningConnection(validTenant);

  assertTenantConnection({
    connection,
    tenant: validTenant,
  });

  const models = getTenantAccountingModels(connection);

  assertModels({
    models,
    connection,
    modelNames: MODEL_NAMES,
  });

  const existingCollections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  if (existingCollections.length !== 0) {
    throw new Error(
      "Refusing initial provisioning into a non-empty database",
    );
  }

  for (const name of MODEL_NAMES) {
    await models[name].createCollection();
    await models[name].createIndexes();
  }

  await connection.db.createCollection("counters");

  const session = await connection.startSession();

  let warehouseSeedResult = null;

  try {
    await session.withTransaction(async () => {
      await seedDefaultLedgerGroups({
        tenantId: validTenant._id,
        models,
        userId,
        session,
      });

      await seedDefaultLedgers({
        tenantId: validTenant._id,
        models,
        userId,
        session,
      });

      const groupCount =
        await models.LedgerGroup.countDocuments({
          tenantId: validTenant._id,
        }).session(session);

      const ledgerCount =
        await models.Ledger.countDocuments({
          tenantId: validTenant._id,
        }).session(session);

      if (
        groupCount !==
        DEFAULT_LEDGER_GROUPS.length
      ) {
        throw new Error(
          "Tenant Ledger group seed verification failed",
        );
      }

      if (
        ledgerCount !==
        DEFAULT_LEDGERS.length
      ) {
        throw new Error(
          "Tenant Ledger seed verification failed",
        );
      }

      warehouseSeedResult =
        await seedDefaultWarehouse({
          tenantId: validTenant._id,
          models,
          userId,
          session,
        });
    });
  } finally {
    await session.endSession();
  }

  return {
    databaseName: connection.name,
    databaseSchemaVersion: 1,

    warehouse: {
      seeded: true,
      warehouseCode: "MAIN",
      warehouseId:
        warehouseSeedResult?.defaultWarehouse?._id ||
        warehouseSeedResult?.defaultWarehouse?.id ||
        null,

      settingsId:
        warehouseSeedResult?.settings?._id ||
        warehouseSeedResult?.settings?.id ||
        null,
    },
  };
};

const provisionWarehousesForTenant = async ({
  tenant,
  userId = null,
}) => {
  const validTenant = assertTenant(tenant);

  // Must use the same resolver as warehouse.service.js
  const connection =
    getReadyTenantConnection(validTenant);

  assertTenantConnection({
    connection,
    tenant: validTenant,
  });

  const models =
    getTenantAccountingModels(connection);

  assertModels({
    models,
    connection,
    modelNames: WAREHOUSE_MODEL_NAMES,
  });

  await ensureWarehouseCollections(connection);
  await ensureWarehouseIndexes(models);

  const tenantId = mongoose.isObjectIdOrHexString(
    validTenant._id,
  )
    ? new mongoose.Types.ObjectId(
        String(validTenant._id),
      )
    : validTenant._id;

  const normalizedUserId =
    userId && mongoose.isObjectIdOrHexString(userId)
      ? new mongoose.Types.ObjectId(String(userId))
      : userId;

  const session =
    await connection.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      result = await seedDefaultWarehouse({
        tenantId,
        models,
        userId: normalizedUserId,
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  return {
    alreadyProvisioned: false,
    warehouse: result.defaultWarehouse,
    settings: result.settings,
  };
};

module.exports = {
  provisionTenantDatabase,
  provisionWarehousesForTenant,
};