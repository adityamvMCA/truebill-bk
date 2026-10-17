const path = require("path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");


const envResult = require("dotenv").config({
  path: path.resolve(__dirname, "../.env.tenant-test"),
  quiet: true,
});


const { getTenantDatabaseName } = require("../src/tenancy/tenantDatabaseNames");


const {
  getProvisioningConnection,
} = require("../src/tenancy/tenantConnectionManager");


const {
  getTenantAccountingModels,
} = require("../src/tenancy/tenantAccountingModels");


const {
  DEFAULT_LEDGER_GROUPS,
  seedDefaultLedgerGroups,
} = require("../src/modules/accounting/seeds/seedDefaultLedgerGroups");


const {
  DEFAULT_LEDGERS,
  seedDefaultLedgers,
} = require("../src/modules/accounting/seeds/seedDefaultLedgers");


const purchaseBillService = require("../src/modules/purchase-bills/purchaseBill.service");


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


  const expectedMainDb = settings.TENANT_TEST_EXPECTED_MAIN_DB?.trim();


  if (
    !uri ||
    (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://"))
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


  const databaseKey = `test_${randomBytes(6).toString("hex")}`;


  const databaseName = getTenantDatabaseName(databaseKey);


  const tenant = {
    _id: tenantId,
    businessName: `Purchase Bill Test ${label}`,
    databaseKey,
    databaseName,
    storageMode: "DEDICATED",
    provisioningStatus: "PROVISIONING",
    isActive: true,
    status: "active",
  };


  const connection = getProvisioningConnection(tenant);


  const models = getTenantAccountingModels(connection);


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
  const { tenantId, databaseName, connection, models } = context;


  const collections = await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();


  assert.equal(
    collections.length,
    0,
    "Refusing to reuse an existing test database",
  );


  createdDatabases.push(databaseName);


  const modelEntries = {
    LedgerGroup: models.LedgerGroup,
    Ledger: models.Ledger,
    AuditLog: models.AuditLog,
    Bank: models.Bank,
    Journal: models.Journal,
    PurchaseBill: models.PurchaseBill,
    Supplier: models.Supplier,
    Product: models.Product,
    StockMovement: models.StockMovement,
  };


  for (const [modelName, model] of Object.entries(modelEntries)) {
    if (!model) {
      throw new Error(`Tenant model is missing: ${modelName}`);
    }


    if (model.db !== connection) {
      throw new Error(`Tenant model has the wrong connection: ${modelName}`);
    }


    await model.createCollection();
    await model.createIndexes();
  }


  const session = await connection.startSession();


  try {
    await session.withTransaction(async () => {
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
    });
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


  console.log(`${context.label} provisioned: ${databaseName}`);
};


const getReadyTenant = (context) => ({
  ...context.tenant,
  provisioningStatus: "READY",
});


const createTestSupplier = async (context) => {
  const { Supplier, Ledger, LedgerGroup } = context.models;


  const tenantId = context.tenantId;


  const group = await LedgerGroup.findOne({
    tenantId,
    code: "SUNDRY_CREDITORS",
    isActive: true,
  }).lean();


  assert.ok(group, "SUNDRY_CREDITORS ledger group is missing");


  const supplierCode = `SUP${randomBytes(4).toString("hex").toUpperCase()}`;


  const supplierRecords = await Supplier.create([
    {
      tenantId,
      supplierCode,
      supplierName: "Test Supplier",
      supplierType: "Business",
      gstNo: "27ABCDE1234F1Z5",
      paymentTerms: "Due on Receipt",
      openingBalance: 0,
      openingBalanceType: "CREDIT",
      payableBalance: 0,
      status: "Active",
    },
  ]);


  const supplier = supplierRecords[0];


  const ledgerRecords = await Ledger.create([
    {
      tenantId,
      ledgerGroupId: group._id,
      code: `SUPP-${supplierCode}`,
      name: "Test Supplier",
      type: "SUPPLIER",
      nature: "LIABILITY",
      normalBalance: "CREDIT",
      openingBalance: 0,
      openingBalanceType: "CREDIT",
      currentBalance: 0,
      currentBalanceType: "CREDIT",
      referenceType: "SUPPLIER",
      referenceId: supplier._id,
      isSystem: false,
      isActive: true,
    },
  ]);


  supplier.ledgerId = ledgerRecords[0]._id;


  await supplier.save();


  console.log("PASS: test supplier and supplier ledger created");


  return supplier;
};


const createTestProduct = async (context) => {
  const { Product, Ledger } = context.models;


  const tenantId = context.tenantId;


  const purchaseLedger = await Ledger.findOne({
    tenantId,
    code: "PURCHASE",
    isActive: true,
  }).lean();


  assert.ok(purchaseLedger, "PURCHASE ledger is missing");


  const productCode = `PRD${randomBytes(4).toString("hex").toUpperCase()}`;


  const productRecords = await Product.create([
    {
      tenantId,
      productCode,
      name: "Test Inventory Product",
      type: "GOODS",
      unit: "NOS",
      gstRate: 18,
      trackInventory: true,
      openingStock: 0,
      openingStockRate: 0,
      currentStock: 0,
      purchaseLedgerId: purchaseLedger._id,
      status: "ACTIVE",
    },
  ]);


  console.log("PASS: test inventory product created");


  return productRecords[0];
};


const createPostedBill = async (context, supplier, product) => {
  const tenant = getReadyTenant(context);


  const bill = await purchaseBillService.createPurchaseBill({
    tenant,
    userId: context.tenantId,
    payload: {
      action: "SAVEANDPOST",
      supplierId: supplier._id.toString(),
      supplierInvoiceNumber: `INV-${randomBytes(4)
        .toString("hex")
        .toUpperCase()}`,
      billDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      paymentTerms: "Due on Receipt",
      taxMode: "INTRASTATE",
      updateStock: true,
      items: [
        {
          productId: product._id.toString(),
          quantity: 10,
          unitRate: 100,
          discountPercent: 0,
          gstRate: 18,
          taxCreditEligible: true,
        },
      ],
      notes: "Tenant purchase bill test",
    },
    ipAddress: "127.0.0.1",
  });


  assert.ok(bill);
  assert.equal(bill.status, "POSTED");
  assert.ok(bill.journalId);
  assert.ok(bill.postedAt);


  const { PurchaseBill, Journal, Ledger, StockMovement, Product, Supplier } =
    context.models;


  const savedBill = await PurchaseBill.findById(bill._id).lean();


  assert.ok(savedBill);


  const journal = await Journal.findById(savedBill.journalId).lean();


  assert.ok(journal);


  assert.equal(journal.sourceType, "PURCHASE_BILL");


  assert.equal(String(journal.sourceId), String(savedBill._id));


  const purchaseLedger = await Ledger.findOne({
    tenantId: context.tenantId,
    code: "PURCHASE",
  }).lean();


  assert.ok(purchaseLedger);
  assert.equal(purchaseLedger.currentBalance, 1000);


  const supplierLedger = await Ledger.findById(supplier.ledgerId).lean();


  assert.ok(supplierLedger);
  assert.equal(supplierLedger.currentBalance, 1180);


  assert.equal(supplierLedger.currentBalanceType, "CREDIT");


  const updatedSupplier = await Supplier.findById(supplier._id).lean();


  assert.equal(updatedSupplier.payableBalance, 1180);


  const movement = await StockMovement.findOne({
    tenantId: context.tenantId,
    referenceType: "PURCHASE_BILL",
    referenceId: savedBill._id,
  }).lean();


  assert.ok(movement);
  assert.equal(movement.direction, "IN");
  assert.equal(movement.quantity, 10);


  const updatedProduct = await Product.findById(product._id).lean();


  assert.equal(updatedProduct.currentStock, 10);


  console.log(
    "PASS: purchase bill, journal, ledgers, supplier payable, stock movement, and product stock created",
  );


  return {
    bill: savedBill,
    journal,
  };
};


const verifyTenantBUnchanged = async (context) => {
  const { PurchaseBill, Journal, StockMovement, Supplier, Product } =
    context.models;


  assert.equal(await PurchaseBill.countDocuments({}), 0);


  assert.equal(await Journal.countDocuments({}), 0);


  assert.equal(await StockMovement.countDocuments({}), 0);


  assert.equal(await Supplier.countDocuments({}), 0);


  assert.equal(await Product.countDocuments({}), 0);


  console.log("PASS: Tenant B remained unchanged");
};


const verifyRollback = async (context, supplier, product) => {
  const tenant = getReadyTenant(context);


  const connection = context.connection;


  const { PurchaseBill, Journal, Ledger, StockMovement, Product } =
    context.models;


  const purchaseBefore = await Ledger.findOne({
    tenantId: context.tenantId,
    code: "PURCHASE",
  }).lean();


  const supplierLedgerBefore = await Ledger.findById(supplier.ledgerId).lean();


  const productBefore = await Product.findById(product._id).lean();


  const billsBefore = await PurchaseBill.countDocuments({});


  const journalsBefore = await Journal.countDocuments({});


  const movementsBefore = await StockMovement.countDocuments({});


  let forcedFailure = false;


  const originalCreate = context.models.Journal.create.bind(
    context.models.Journal,
  );


  context.models.Journal.create = async (documents, options) => {
    const result = await originalCreate(documents, options);


    forcedFailure = true;


    throw new Error("Intentional purchase bill rollback failure");
  };


  try {
    await purchaseBillService.createPurchaseBill({
      tenant,
      userId: context.tenantId,
      payload: {
        action: "SAVEANDPOST",
        supplierId: supplier._id.toString(),
        supplierInvoiceNumber: `ROLLBACK-${randomBytes(4)
          .toString("hex")
          .toUpperCase()}`,
        billDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        paymentTerms: "Due on Receipt",
        taxMode: "INTRASTATE",
        updateStock: true,
        items: [
          {
            productId: product._id.toString(),
            quantity: 5,
            unitRate: 100,
            discountPercent: 0,
            gstRate: 18,
            taxCreditEligible: true,
          },
        ],
      },
      ipAddress: "127.0.0.1",
    });


    assert.fail("Expected purchase bill posting to fail");
  } catch (error) {
    assert.equal(error.message, "Intentional purchase bill rollback failure");
  } finally {
    context.models.Journal.create = originalCreate;
  }


  assert.equal(forcedFailure, true);


  assert.equal(
    await PurchaseBill.countDocuments({}),
    billsBefore,
    "Purchase bill was not rolled back",
  );


  assert.equal(
    await Journal.countDocuments({}),
    journalsBefore,
    "Journal was not rolled back",
  );


  assert.equal(
    await StockMovement.countDocuments({}),
    movementsBefore,
    "Stock movement was not rolled back",
  );


  const purchaseAfter = await Ledger.findOne({
    tenantId: context.tenantId,
    code: "PURCHASE",
  }).lean();


  const supplierLedgerAfter = await Ledger.findById(supplier.ledgerId).lean();


  const productAfter = await Product.findById(product._id).lean();


  assert.equal(purchaseAfter.currentBalance, purchaseBefore.currentBalance);


  assert.equal(
    supplierLedgerAfter.currentBalance,
    supplierLedgerBefore.currentBalance,
  );


  assert.equal(productAfter.currentStock, productBefore.currentStock);


  console.log(
    "PASS: forced failure rolled back bill, journal, ledger balances, stock movement, and product stock",
  );
};


const verifyMainDatabase = async (contexts) => {
  const tenantIds = contexts.map((context) => context.tenantId);


  const collectionNames = [
    "purchasebills",
    "accountingjournals",
    "accountingledgers",
    "stockmovements",
    "suppliers",
    "products",
    "auditlogs",
  ];


  for (const collectionName of collectionNames) {
    const count = await mongoose.connection.db
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


  console.log("PASS: no test records found in main database");
};


const run = async () => {
  const { uri, expectedMainDb } = validateConfiguration();


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


  console.log("Connected test main database:", mongoose.connection.name);


  process.env.TENANT_DATABASES_ENABLED = "true";


  const contextA = createTenantContext("Tenant A");


  const contextB = createTenantContext("Tenant B");


  await provisionTenant(contextA);
  await provisionTenant(contextB);


  const supplier = await createTestSupplier(contextA);


  const product = await createTestProduct(contextA);


  await createPostedBill(contextA, supplier, product);


  await verifyTenantBUnchanged(contextB);


  await verifyRollback(contextA, supplier, product);


  await verifyMainDatabase([contextA, contextB]);


  console.log("Tenant purchase bill test PASSED");


  console.log("No Tenant record was saved or marked READY.");


  console.log("No API routing was changed.");
};


run()
  .catch((error) => {
    console.error("Tenant purchase bill test FAILED:", error.message);


    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdDatabases.length) {
      console.log("Test databases retained for inspection:");


      for (const databaseName of createdDatabases) {
        console.log(`- ${databaseName}`);
      }
    }


    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error.message);


      process.exitCode = 1;
    }
  });