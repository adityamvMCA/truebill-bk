const { getProvisioningConnection } = require("./tenantConnectionManager");

const { getTenantAccountingModels } = require("./tenantAccountingModels");

const {
  DEFAULT_LEDGER_GROUPS,
  seedDefaultLedgerGroups,
} = require("../modules/accounting/seeds/seedDefaultLedgerGroups");

const {
  DEFAULT_LEDGERS,
  seedDefaultLedgers,
} = require("../modules/accounting/seeds/seedDefaultLedgers");

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
];

const provisionTenantDatabase = async ({ tenant, userId = null }) => {
  const connection = getProvisioningConnection(tenant);

  const models = getTenantAccountingModels(connection);

  if (connection.name !== tenant.databaseName) {
    throw new Error(
      "Tenant provisioning connection does not match databaseName",
    );
  }

  const existingCollections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  if (existingCollections.length !== 0) {
    throw new Error("Refusing initial provisioning into a non-empty database");
  }

  for (const name of MODEL_NAMES) {
    const model = models[name];

    if (!model || model.db !== connection) {
      throw new Error(`Invalid tenant provisioning model: ${name}`);
    }
  }

  for (const name of MODEL_NAMES) {
    await models[name].createCollection();
    await models[name].createIndexes();
  }

  await connection.db.createCollection("counters");

  const session = await connection.startSession();

  try {
    await session.withTransaction(async () => {
      await seedDefaultLedgerGroups({
        tenantId: tenant._id,
        models,
        userId,
        session,
      });

      await seedDefaultLedgers({
        tenantId: tenant._id,
        models,
        userId,
        session,
      });

      const groupCount = await models.LedgerGroup.countDocuments({
        tenantId: tenant._id,
      }).session(session);

      const ledgerCount = await models.Ledger.countDocuments({
        tenantId: tenant._id,
      }).session(session);

      if (groupCount !== DEFAULT_LEDGER_GROUPS.length) {
        throw new Error("Tenant Ledger group seed verification failed");
      }

      if (ledgerCount !== DEFAULT_LEDGERS.length) {
        throw new Error("Tenant Ledger seed verification failed");
      }
    });
  } finally {
    await session.endSession();
  }

  return {
    databaseName: connection.name,
    databaseSchemaVersion: 1,
  };
};

module.exports = {
  provisionTenantDatabase,
};
