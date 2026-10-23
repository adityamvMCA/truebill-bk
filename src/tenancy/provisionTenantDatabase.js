// const mongoose = require("mongoose");

// const {
//   getReadyTenantConnection,
//   getProvisioningConnection,
// } = require("./tenantConnectionManager");

// const { getTenantAccountingModels } = require("./tenantAccountingModels");

// const {
//   DEFAULT_LEDGER_GROUPS,
//   seedDefaultLedgerGroups,
// } = require("../modules/accounting/seeds/seedDefaultLedgerGroups");

// const {
//   DEFAULT_LEDGERS,
//   seedDefaultLedgers,
// } = require("../modules/accounting/seeds/seedDefaultLedgers");

// const {
//   seedDefaultWarehouse,
// } = require("../modules/Inventory/warehouses/seedDefaultWarehouse");

// const {
//   seedDefaultProductMasters,
// } = require("../modules/Inventory/seeds/seedDefaultProductMasters");

// const {
//   seedDefaultProductUnits,
// } = require("../modules/Inventory/seeds/seedDefaultProductUnits");

// const {
//   seedDefaultTaxMasters,
// } = require("../modules/Inventory/seeds/seedDefaultTaxMasters");

// const MODEL_NAMES = [
//   "LedgerGroup",
//   "Ledger",
//   "AuditLog",
//   "Bank",
//   "Journal",
//   "PurchaseBill",
//   "StockMovement",
//   "Supplier",
//   "Product",
//   "SalesInvoice",
//   "Customer",
//   "CustomerReceipt",
//   "SupplierPayment",
//   "SalesQuotation",
//   "DeliveryNote",
//   "TaxConfiguration",
//   "SupplierQuotation",
//   "PurchaseOrder",
//   "GoodsReceipt",
//   "PurchaseReturn",
//   "ProductCategory",
//   "ProductUnit",
//   "ProductBrand",
//   "HsnSacCode",
//   "TaxRate",
//   "StockAdjustment",
//   "Warehouse",
//   "InventorySettings",
//   "WarehouseStock",
// ];

// const WAREHOUSE_MODEL_NAMES = [
//   "Warehouse",
//   "InventorySettings",
//   "WarehouseStock",
// ];

// const WAREHOUSE_COLLECTIONS = [
//   "warehouses",
//   "inventorysettings",
//   "warehousestocks",
// ];

// const assertTenant = (tenant) => {
//   if (!tenant || typeof tenant !== "object" || !tenant._id) {
//     throw new Error("A valid tenant context is required");
//   }

//   if (!tenant.databaseName || typeof tenant.databaseName !== "string") {
//     throw new Error("Tenant databaseName is required");
//   }

//   return tenant;
// };

// const assertConnection = (connection) => {
//   if (
//     !connection ||
//     typeof connection.model !== "function" ||
//     !connection.models ||
//     !connection.db
//   ) {
//     throw new Error("A valid Mongoose connection is required");
//   }

//   if (connection.readyState !== 1) {
//     throw new Error("The database connection is not ready");
//   }

//   return connection;
// };

// const assertTenantConnection = ({ connection, tenant }) => {
//   assertConnection(connection);

//   if (connection.name !== tenant.databaseName) {
//     throw new Error("Tenant connection does not match tenant databaseName");
//   }

//   return connection;
// };

// const assertModels = ({ models, connection, modelNames }) => {
//   if (!models || typeof models !== "object") {
//     throw new Error("Tenant models must be provided");
//   }

//   for (const name of modelNames) {
//     const model = models[name];

//     if (!model || model.db !== connection) {
//       throw new Error(`Invalid tenant model: ${name}`);
//     }
//   }

//   return models;
// };

// const ensureCollection = async (connection, collectionName) => {
//   const exists = await connection.db
//     .listCollections({
//       name: collectionName,
//     })
//     .hasNext();

//   if (exists) {
//     return;
//   }

//   try {
//     await connection.db.createCollection(collectionName);
//   } catch (error) {
//     if (error.code !== 48 && error.codeName !== "NamespaceExists") {
//       throw error;
//     }
//   }
// };

// const ensureWarehouseCollections = async (connection) => {
//   for (const collectionName of WAREHOUSE_COLLECTIONS) {
//     await ensureCollection(connection, collectionName);
//   }
// };

// const ensureWarehouseIndexes = async (models) => {
//   await models.Warehouse.createIndexes();

//   await models.InventorySettings.createIndexes();

//   await models.WarehouseStock.createIndexes();
// };

// const provisionTenantDatabase = async ({ tenant, userId = null }) => {
//   const validTenant = assertTenant(tenant);

//   const connection = getProvisioningConnection(validTenant);

//   assertTenantConnection({
//     connection,
//     tenant: validTenant,
//   });

//   const models = getTenantAccountingModels(connection);

//   assertModels({
//     models,
//     connection,
//     modelNames: MODEL_NAMES,
//   });

//   const existingCollections = await connection.db
//     .listCollections(
//       {},
//       {
//         nameOnly: true,
//       },
//     )
//     .toArray();

//   if (existingCollections.length !== 0) {
//     throw new Error("Refusing initial provisioning into a non-empty database");
//   }

//   for (const name of MODEL_NAMES) {
//     await models[name].createCollection();

//     await models[name].createIndexes();
//   }

//   await connection.db.createCollection("counters");

//   const session = await connection.startSession();

//   let warehouseSeedResult = null;
//   let productMasterSeedResult = null;
//   let unitSeedResult = null;
//   let taxSeedResult = null;

//   try {
//     await session.withTransaction(async () => {
//       await seedDefaultLedgerGroups({
//         tenantId: validTenant._id,
//         models,
//         userId,
//         session,
//       });

//       await seedDefaultLedgers({
//         tenantId: validTenant._id,
//         models,
//         userId,
//         session,
//       });

//       const groupCount = await models.LedgerGroup.countDocuments({
//         tenantId: validTenant._id,
//       }).session(session);

//       const ledgerCount = await models.Ledger.countDocuments({
//         tenantId: validTenant._id,
//       }).session(session);

//       if (groupCount !== DEFAULT_LEDGER_GROUPS.length) {
//         throw new Error("Tenant Ledger group seed verification failed");
//       }

//       if (ledgerCount !== DEFAULT_LEDGERS.length) {
//         throw new Error("Tenant Ledger seed verification failed");
//       }

//       warehouseSeedResult = await seedDefaultWarehouse({
//         tenantId: validTenant._id,
//         models,
//         userId,
//         session,
//       });

//       productMasterSeedResult = await seedDefaultProductMasters({
//         tenantId: validTenant._id,
//         models,
//         userId,
//         session,
//       });

//       unitSeedResult = await seedDefaultProductUnits({
//         tenantId: validTenant._id,
//         models,
//         userId,
//         session,
//       });

//       taxSeedResult = await seedDefaultTaxMasters({
//         tenantId: validTenant._id,
//         models,
//         userId,
//         session,
//       });
//     });
//   } finally {
//     await session.endSession();
//   }

//   return {
//     databaseName: connection.name,
//     databaseSchemaVersion: 1,

//     warehouse: {
//       seeded: true,

//       warehouseCode: "MAIN",

//       warehouseId:
//         warehouseSeedResult?.defaultWarehouse?._id ||
//         warehouseSeedResult?.defaultWarehouse?.id ||
//         null,

//       settingsId:
//         warehouseSeedResult?.settings?._id ||
//         warehouseSeedResult?.settings?.id ||
//         null,
//     },

//     productMasters: {
//       categories: productMasterSeedResult?.categories || null,

//       brands: productMasterSeedResult?.brands || null,

//       units: unitSeedResult || null,

//       taxRates: taxSeedResult?.taxRates || null,

//       hsnSacCodes: taxSeedResult?.hsnSacCodes || null,
//     },
//   };
// };

// const provisionWarehousesForTenant = async ({ tenant, userId = null }) => {
//   const validTenant = assertTenant(tenant);

//   const connection = getReadyTenantConnection(validTenant);

//   assertTenantConnection({
//     connection,
//     tenant: validTenant,
//   });

//   const models = getTenantAccountingModels(connection);

//   assertModels({
//     models,
//     connection,
//     modelNames: WAREHOUSE_MODEL_NAMES,
//   });

//   await ensureWarehouseCollections(connection);

//   await ensureWarehouseIndexes(models);

//   const tenantId = mongoose.isObjectIdOrHexString(validTenant._id)
//     ? new mongoose.Types.ObjectId(String(validTenant._id))
//     : validTenant._id;

//   const normalizedUserId =
//     userId && mongoose.isObjectIdOrHexString(userId)
//       ? new mongoose.Types.ObjectId(String(userId))
//       : userId;

//   const session = await connection.startSession();

//   let result;
//   let alreadyProvisioned = false;

//   try {
//     await session.withTransaction(async () => {
//       const existingSettings = await models.InventorySettings.findOne({
//         tenantId,
//       })
//         .select("_id")
//         .session(session)
//         .lean();

//       alreadyProvisioned = Boolean(existingSettings);

//       result = await seedDefaultWarehouse({
//         tenantId,
//         models,
//         userId: normalizedUserId,
//         session,
//       });
//     });
//   } finally {
//     await session.endSession();
//   }

//   return {
//     alreadyProvisioned,
//     warehouse: result.defaultWarehouse,
//     settings: result.settings,
//   };
// };

// module.exports = {
//   provisionTenantDatabase,
//   provisionWarehousesForTenant,
// };


const mongoose = require("mongoose");
const { performance } = require("node:perf_hooks");
const {
  getReadyTenantConnection,
  getProvisioningConnection,
} = require("./tenantConnectionManager");
const { getTenantAccountingModels } = require("./tenantAccountingModels");
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
const {
  seedDefaultProductMasters,
} = require("../modules/Inventory/seeds/seedDefaultProductMasters");
const {
  seedDefaultProductUnits,
} = require("../modules/Inventory/seeds/seedDefaultProductUnits");
const {
  seedDefaultTaxMasters,
} = require("../modules/Inventory/seeds/seedDefaultTaxMasters");

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

const assertTenant = (tenant) => {
  if (
    !tenant ||
    typeof tenant !== "object" ||
    !mongoose.isObjectIdOrHexString(tenant._id)
  )
    throw new Error("A valid tenant context is required");
  if (typeof tenant.databaseName !== "string" || !tenant.databaseName)
    throw new Error("Tenant databaseName is required");
  return tenant;
};
const assertConnection = (connection, tenant) => {
  if (
    !connection ||
    typeof connection.model !== "function" ||
    !connection.models ||
    !connection.db
  )
    throw new Error("A valid Mongoose connection is required");
  if (connection.readyState !== 1)
    throw new Error("The database connection is not ready");
  if (connection.name !== tenant.databaseName)
    throw new Error("Tenant connection does not match tenant databaseName");
};
const assertModels = (models, connection, names) => {
  for (const name of names) {
    if (!models?.[name] || models[name].db !== connection)
      throw new Error(`Invalid tenant model: ${name}`);
  }
};
const normalizeUserId = (value) => {
  if (value == null) return null;
  if (!mongoose.isObjectIdOrHexString(value))
    throw new Error("A valid userId is required");
  return new mongoose.Types.ObjectId(String(value));
};
const createTimer = (tenantId) => {
  const durations = {};
  const time = async (phase, operation) => {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      const milliseconds = Math.round(performance.now() - start);
      durations[phase] = milliseconds;
      console.info("[tenant.provisioning.phase]", {
        tenantId: String(tenantId),
        phase,
        milliseconds,
      });
    }
  };
  return { durations, time };
};

const prepareModel = async (model) => {
  try {
    await model.createCollection();
  } catch (error) {
    if (error.code !== 48 && error.codeName !== "NamespaceExists") throw error;
  }
  await model.createIndexes();
};

// Used ONLY outside transactions. Every started worker is awaited, even on failure.
const prepareModels = async (models, names, concurrency, time) => {
  let index = 0;
  let firstError = null;
  const worker = async () => {
    while (!firstError && index < names.length) {
      const name = names[index++];
      try {
        await time(`model.${name}`, () => prepareModel(models[name]));
      } catch (error) {
        firstError = firstError || error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, names.length) }, worker),
  );
  if (firstError) throw firstError;
};

const getDdlConcurrency = () => {
  const value = Number(process.env.TENANT_DDL_CONCURRENCY || 3);
  if (!Number.isSafeInteger(value) || value < 1 || value > 4)
    throw new Error(
      "TENANT_DDL_CONCURRENCY must be an integer between 1 and 4",
    );
  return value;
};

const provisionTenantDatabase = async ({ tenant, userId = null }) => {
  const validTenant = assertTenant(tenant);
  const actorId = normalizeUserId(userId);
  const totalStart = performance.now();
  const { durations, time } = createTimer(validTenant._id);
  const connection = getProvisioningConnection(validTenant);
  assertConnection(connection, validTenant);
  const models = getTenantAccountingModels(connection);
  assertModels(models, connection, MODEL_NAMES);
  const existing = await time("checkEmptyDatabase", () =>
    connection.db.listCollections({}, { nameOnly: true }).toArray(),
  );
  if (existing.length)
    throw new Error("Refusing initial provisioning into a non-empty database");

  await time("collectionsAndIndexes", () =>
    prepareModels(models, MODEL_NAMES, getDdlConcurrency(), time),
  );
  await time("countersCollection", () =>
    connection.db.createCollection("counters"),
  );
  const session = await connection.startSession();
  let warehouseSeedResult,
    productMasterSeedResult,
    unitSeedResult,
    taxSeedResult;
  let transactionAttempt = 0;
  try {
    await time("seedTransaction", () =>
      session.withTransaction(async () => {
        transactionAttempt += 1;
        const args = {
          tenantId: validTenant._id,
          models,
          userId: actorId,
          session,
        };
        const phase = (label, operation) =>
          time(`attempt${transactionAttempt}.${label}`, operation);
        await phase("ledgerGroups", () => seedDefaultLedgerGroups(args));
        await phase("ledgers", () => seedDefaultLedgers(args));
        await phase("verifyLedgers", async () => {
          const groupCount = await models.LedgerGroup.countDocuments({
            tenantId: validTenant._id,
          }).session(session);
          const ledgerCount = await models.Ledger.countDocuments({
            tenantId: validTenant._id,
          }).session(session);
          if (groupCount !== DEFAULT_LEDGER_GROUPS.length)
            throw new Error("Tenant Ledger group seed verification failed");
          if (ledgerCount !== DEFAULT_LEDGERS.length)
            throw new Error("Tenant Ledger seed verification failed");
        });
        warehouseSeedResult = await phase("warehouse", () =>
          seedDefaultWarehouse(args),
        );
        productMasterSeedResult = await phase("categoriesAndBrands", () =>
          seedDefaultProductMasters(args),
        );
        unitSeedResult = await phase("units", () =>
          seedDefaultProductUnits(args),
        );
        taxSeedResult = await phase("taxMasters", () =>
          seedDefaultTaxMasters(args),
        );
      }),
    );
  } finally {
    await session.endSession();
    console.info("[tenant.provisioning.total]", {
      tenantId: String(validTenant._id),
      milliseconds: Math.round(performance.now() - totalStart),
      transactionAttempts: transactionAttempt,
    });
  }
  return {
    databaseName: connection.name,
    databaseSchemaVersion: 1,
    warehouse: {
      seeded: true,
      warehouseCode: "MAIN",
      warehouseId: warehouseSeedResult?.defaultWarehouse?._id || null,
      settingsId: warehouseSeedResult?.settings?._id || null,
    },
    productMasters: {
      categories: productMasterSeedResult?.categories || null,
      brands: productMasterSeedResult?.brands || null,
      units: unitSeedResult || null,
      taxRates: taxSeedResult?.taxRates || null,
      hsnSacCodes: taxSeedResult?.hsnSacCodes || null,
    },
  };
};

const provisionWarehousesForTenant = async ({ tenant, userId = null }) => {
  const validTenant = assertTenant(tenant);
  const connection = getReadyTenantConnection(validTenant);
  assertConnection(connection, validTenant);
  const models = getTenantAccountingModels(connection);
  assertModels(models, connection, WAREHOUSE_MODEL_NAMES);
  const tenantId = new mongoose.Types.ObjectId(String(validTenant._id));
  const actorId = normalizeUserId(userId);
  for (const name of WAREHOUSE_MODEL_NAMES) await prepareModel(models[name]);
  const session = await connection.startSession();
  let result;
  let alreadyProvisioned = false;
  try {
    await session.withTransaction(async () => {
      alreadyProvisioned = Boolean(
        await models.InventorySettings.findOne({ tenantId })
          .select("_id")
          .session(session)
          .lean(),
      );
      result = await seedDefaultWarehouse({
        tenantId,
        models,
        userId: actorId,
        session,
      });
    });
  } finally {
    await session.endSession();
  }
  return {
    alreadyProvisioned,
    warehouse: result.defaultWarehouse,
    settings: result.settings,
  };
};

module.exports = { provisionTenantDatabase, provisionWarehousesForTenant };
