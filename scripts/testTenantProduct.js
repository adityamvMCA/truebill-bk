const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");

const envResult = require("dotenv").config({
  path: path.resolve(__dirname, "../.env.tenant-test"),
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

const productService = require(
  "../src/modules/products/product.service",
);

const contexts = [];
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

  const expectedMainDb =
    settings.TENANT_TEST_EXPECTED_MAIN_DB?.trim();

  if (
    !uri ||
    (
      !uri.startsWith("mongodb://") &&
      !uri.startsWith("mongodb+srv://")
    )
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
  const userId = new mongoose.Types.ObjectId();

  const databaseKey = `test_${randomBytes(6).toString("hex")}`;
  const databaseName = getTenantDatabaseName(databaseKey);

  const tenant = {
    _id: tenantId,
    businessName: `Product Test ${label}`,
    databaseKey,
    databaseName,
    storageMode: "DEDICATED",
    provisioningStatus: "PROVISIONING",
    isActive: true,
    status: "active",
  };

  const connection = getProvisioningConnection(tenant);
  const models = getTenantAccountingModels(connection);

  const context = {
    label,
    tenant,
    tenantId,
    userId,
    databaseName,
    connection,
    models,
  };

  contexts.push(context);

  return context;
};

const provisionTenant = async (context) => {
  const {
    connection,
    models,
    databaseName,
  } = context;

  assert.notEqual(
    databaseName,
    mongoose.connection.name,
    "Tenant database must not be the main database",
  );

  assert.equal(
    connection.name,
    databaseName,
    "Tenant connection has the wrong database name",
  );

  const collections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  assert.equal(
    collections.length,
    0,
    "Refusing to reuse an existing test database",
  );

  const modelEntries = {
    Product: models.Product,
    StockMovement: models.StockMovement,
    AuditLog: models.AuditLog,
  };

  for (const [name, model] of Object.entries(modelEntries)) {
    assert.ok(model, `Tenant model is missing: ${name}`);

    assert.equal(
      model.db,
      connection,
      `Tenant model has the wrong connection: ${name}`,
    );
  }

  createdDatabases.push(databaseName);

  for (const model of Object.values(modelEntries)) {
    await model.createCollection();
    await model.createIndexes();
  }

  await connection.db.createCollection("counters");

  console.log(`${context.label} provisioned: ${databaseName}`);
};

const getReadyTenant = (context) => ({
  ...context.tenant,
  provisioningStatus: "READY",
});

const getCounter = async (context) => {
  return context.connection.db
    .collection("counters")
    .findOne({
      _id: `${context.tenantId}_PR`,
    });
};

const createGoods = async (context, name, openingStock = 10) => {
  return productService.createProduct({
    tenant: getReadyTenant(context),
    userId: context.userId,
    payload: {
      name,
      type: "GOODS",
      unit: "NOS",
      gstRate: 18,
      salePrice: 150,
      purchasePrice: 100,
      trackInventory: true,
      openingStock,
      openingStockRate: 100,
      reorderLevel: 2,
      status: "ACTIVE",
    },
    ipAddress: "127.0.0.1",
  });
};

const verifyProductCreation = async (context) => {
  const product = await createGoods(
    context,
    "Tenant A Inventory Product",
  );

  assert.equal(product.productCode, "PR001");
  assert.equal(product.currentStock, 10);
  assert.equal(String(product.tenantId), String(context.tenantId));

  const savedProduct = await context.models.Product
    .findById(product._id)
    .lean();

  assert.ok(savedProduct);
  assert.equal(savedProduct.currentStock, 10);

  const movements = await context.models.StockMovement.find({
    tenantId: context.tenantId,
    productId: product._id,
  }).lean();

  assert.equal(movements.length, 1);

  const movement = movements[0];

  assert.equal(movement.movementType, "OPENING");
  assert.equal(movement.direction, "IN");
  assert.equal(movement.quantity, 10);
  assert.equal(movement.unitRate, 100);
  assert.equal(movement.totalValue, 1000);
  assert.equal(movement.stockBefore, 0);
  assert.equal(movement.stockAfter, 10);
  assert.equal(movement.referenceType, "OPENING");

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "PRODUCT",
    action: "CREATE",
    documentId: product._id,
  }).lean();

  assert.ok(audit, "Product CREATE audit record is missing");

  const counter = await getCounter(context);

  assert.ok(counter, "Tenant-local Product counter is missing");
  assert.equal(counter.seq, 1);

  console.log(
    "PASS: Product, opening stock movement, audit, and tenant-local PR001 counter created",
  );

  return product;
};

const verifyTenantBInitiallyEmpty = async (context) => {
  for (const model of [
    context.models.Product,
    context.models.StockMovement,
    context.models.AuditLog,
  ]) {
    assert.equal(await model.countDocuments({}), 0);
  }

  assert.equal(
    await context.connection.db
      .collection("counters")
      .countDocuments({}),
    0,
  );

  console.log("PASS: Tenant B remained empty after Tenant A creation");
};

const verifyIndependentCounters = async (contextA, contextB) => {
  const productB = await createGoods(
    contextB,
    "Tenant B Inventory Product",
    4,
  );

  assert.equal(productB.productCode, "PR001");
  assert.equal(productB.currentStock, 4);

  const secondProductA = await createGoods(
    contextA,
    "Tenant A Second Product",
    0,
  );

  assert.equal(secondProductA.productCode, "PR002");

  assert.equal((await getCounter(contextA)).seq, 2);
  assert.equal((await getCounter(contextB)).seq, 1);

  const crossTenantLookup = await productService.getProductByCode({
    tenant: getReadyTenant(contextB),
    productCode: "PR002",
  });

  assert.equal(crossTenantLookup, null);

  console.log(
    "PASS: tenant counters are independent and Product lookups are isolated",
  );
};

const verifyServiceProduct = async (context) => {
  const product = await productService.createProduct({
    tenant: getReadyTenant(context),
    userId: context.userId,
    payload: {
      name: "Test Consulting Service",
      type: "SERVICE",
      unit: "HOUR",
      gstRate: 18,
      salePrice: 500,
      purchasePrice: 0,
      trackInventory: false,
      openingStock: 0,
      openingStockRate: 0,
      reorderLevel: 0,
      status: "ACTIVE",
    },
    ipAddress: "127.0.0.1",
  });

  assert.equal(product.productCode, "PR003");
  assert.equal(product.trackInventory, false);
  assert.equal(product.currentStock, 0);

  assert.equal(
    await context.models.StockMovement.countDocuments({
      productId: product._id,
    }),
    0,
  );

  console.log("PASS: Service product created without a stock movement");
};

const verifyReadAndUpdate = async (context, product) => {
  const tenant = getReadyTenant(context);

  const found = await productService.getProductByCode({
    tenant,
    productCode: product.productCode.toLowerCase(),
  });

  assert.ok(found);
  assert.equal(String(found._id), String(product._id));

  const updated = await productService.updateProduct({
    tenant,
    userId: context.userId,
    productCode: product.productCode,
    payload: {
      name: "Updated Inventory Product",
      salePrice: 175,
      currentStock: 999,
      openingStock: 999,
      productCode: "CHANGED",
    },
    ipAddress: "127.0.0.1",
  });

  assert.equal(updated.name, "Updated Inventory Product");
  assert.equal(updated.salePrice, 175);
  assert.equal(updated.productCode, "PR001");
  assert.equal(updated.currentStock, 10);
  assert.equal(updated.openingStock, 10);

  const result = await productService.getProducts({
    tenant,
    search: "Updated Inventory Product",
    type: "GOODS",
    trackInventory: true,
    page: 1,
    limit: 20,
  });

  assert.equal(result.pagination.total, 1);
  assert.equal(result.data.length, 1);
  assert.equal(String(result.data[0]._id), String(product._id));

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "PRODUCT",
    action: "UPDATE",
    documentId: product._id,
  }).lean();

  assert.ok(audit);

  console.log(
    "PASS: Product lookup, listing, update, protected fields, and update audit verified",
  );
};

const verifyCsvImport = async (context) => {
  const buffer = Buffer.from(
    [
      "name,type,unit,gst_rate,track_inventory,opening_stock,opening_stock_rate",
      "CSV Inventory Product,GOODS,NOS,18,true,3,50",
      "CSV Consulting Service,SERVICE,HOUR,18,false,0,0",
    ].join("\n"),
    "utf8",
  );

  const result = await productService.importProducts({
    tenant: getReadyTenant(context),
    userId: context.userId,
    buffer,
    ipAddress: "127.0.0.1",
  });

  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 0);

  const goods = await context.models.Product.findOne({
    tenantId: context.tenantId,
    name: "CSV Inventory Product",
  }).lean();

  assert.ok(goods);
  assert.equal(goods.currentStock, 3);

  const movement = await context.models.StockMovement.findOne({
    tenantId: context.tenantId,
    productId: goods._id,
    movementType: "OPENING",
  }).lean();

  assert.ok(movement);
  assert.equal(movement.quantity, 3);
  assert.equal(movement.totalValue, 150);

  console.log("PASS: CSV import used tenant Product service and opening stock");
};

const snapshotTenant = async (context) => {
  const result = {};

  for (const name of ["Product", "StockMovement", "AuditLog"]) {
    const documents = await context.models[name]
      .find({})
      .sort({ _id: 1 })
      .lean();

    result[name] = JSON.stringify(documents);
  }

  const counters = await context.connection.db
    .collection("counters")
    .find({})
    .sort({ _id: 1 })
    .toArray();

  result.counters = JSON.stringify(counters);

  return result;
};

const verifyRollback = async (context) => {
  const before = await snapshotTenant(context);

  const AuditLog = context.models.AuditLog;
  const originalCreate = AuditLog.create;

  const failureMessage = "Intentional Product rollback failure";

  let forcedFailure = false;

  AuditLog.create = async function (...args) {
    await originalCreate.apply(this, args);

    forcedFailure = true;

    throw new Error(failureMessage);
  };

  try {
    await assert.rejects(
      () => createGoods(
        context,
        "Product That Must Roll Back",
        5,
      ),
      (error) => error.message === failureMessage,
    );
  } finally {
    AuditLog.create = originalCreate;
  }

  assert.equal(
    forcedFailure,
    true,
    "Failure injection was not reached",
  );

  assert.deepEqual(
    await snapshotTenant(context),
    before,
    "Product transaction did not fully roll back",
  );

  console.log(
    "PASS: forced failure rolled back Product, stock movement, audit, and counter",
  );
};

const verifySoftDelete = async (context, product) => {
  const tenant = getReadyTenant(context);

  await productService.deleteProduct({
    tenant,
    userId: context.userId,
    productCode: product.productCode,
    ipAddress: "127.0.0.1",
  });

  const deleted = await context.models.Product
    .findById(product._id)
    .lean();

  assert.ok(deleted);
  assert.equal(deleted.isDeleted, true);
  assert.equal(deleted.status, "INACTIVE");
  assert.ok(deleted.deletedAt);
  assert.equal(String(deleted.deletedBy), String(context.userId));

  const visible = await productService.getProductByCode({
    tenant,
    productCode: product.productCode,
  });

  assert.equal(visible, null);

  const audit = await context.models.AuditLog.findOne({
    tenantId: context.tenantId,
    module: "PRODUCT",
    action: "DELETE",
    documentId: product._id,
  }).lean();

  assert.ok(audit);

  console.log("PASS: Product soft deletion and DELETE audit verified");
};

const verifyMainDatabase = async () => {
  const tenantIds = contexts.map((context) => context.tenantId);

  const collectionNames = new Set();

  for (const context of contexts) {
    for (const name of ["Product", "StockMovement", "AuditLog"]) {
      collectionNames.add(context.models[name].collection.name);
    }
  }

  for (const collectionName of collectionNames) {
    assert.equal(
      await mongoose.connection.db
        .collection(collectionName)
        .countDocuments({
          tenantId: { $in: tenantIds },
        }),
      0,
      `Test records found in main collection: ${collectionName}`,
    );
  }

  const mainCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  if (mainCollections.some((item) => item.name === "counters")) {
    const counterIds = contexts.map(
      (context) => `${context.tenantId}_PR`,
    );

    assert.equal(
      await mongoose.connection.db
        .collection("counters")
        .countDocuments({
          _id: { $in: counterIds },
        }),
      0,
      "Product counters leaked into the main database",
    );
  }

  console.log(
    "PASS: no Product, stock, audit, or Product counter test records found in main database",
  );
};

const run = async () => {
  const { uri, expectedMainDb } = validateConfiguration();

  process.env.TENANT_DATABASES_ENABLED = "true";

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

  const contextA = createTenantContext("Tenant A");
  const contextB = createTenantContext("Tenant B");

  await provisionTenant(contextA);
  await provisionTenant(contextB);

  const productA = await verifyProductCreation(contextA);

  await verifyTenantBInitiallyEmpty(contextB);
  await verifyIndependentCounters(contextA, contextB);

  const tenantBBefore = await snapshotTenant(contextB);

  await verifyServiceProduct(contextA);
  await verifyReadAndUpdate(contextA, productA);
  await verifyCsvImport(contextA);
  await verifyRollback(contextA);
  await verifySoftDelete(contextA, productA);

  assert.deepEqual(
    await snapshotTenant(contextB),
    tenantBBefore,
    "Tenant B changed during Tenant A operations",
  );

  console.log("PASS: Tenant B remained unchanged during Tenant A operations");

  await verifyMainDatabase();

  console.log("Tenant Product test PASSED");
  console.log("No Tenant record was saved or marked READY.");
  console.log("No API routing was changed.");
};

run()
  .catch((error) => {
    console.error(
      "Tenant Product test FAILED:",
      error.stack || error.message,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdDatabases.length) {
      console.log("Test databases retained for inspection:");

      for (const name of createdDatabases) {
        console.log(`- ${name}`);
      }
    }

    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error.message);
      process.exitCode = 1;
    }
  });