const mongoose = require("mongoose");

const {
  getReadyTenantConnection,
} = require("./tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("./tenantAccountingModels");

const createError = (
  message,
  statusCode = 400,
) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const objectId = (value, label) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(
      `${label} must be a valid ObjectId`,
    );
  }

  return new mongoose.Types.ObjectId(
    String(value),
  );
};

const quantityMilli = (
  value,
  label,
  allowZero = true,
) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    throw createError(
      `${label} contains an invalid quantity`,
      409,
    );
  }

  const scaled = value * 1000;
  const integer = Math.round(scaled);

  if (
    !Number.isSafeInteger(integer) ||
    Math.abs(scaled - integer) > 0.000001
  ) {
    throw createError(
      `${label} exceeds the supported quantity precision or range`,
      409,
    );
  }

  return integer;
};

const resolveContext = ({
  tenant,
  userId,
}) => {
  if (!tenant?._id) {
    throw createError(
      "Resolved tenant context is required",
      500,
    );
  }

  const connection =
    getReadyTenantConnection(tenant);

  if (
    tenant.databaseName &&
    connection.name !== tenant.databaseName
  ) {
    throw createError(
      "Tenant database does not match the migration target",
      500,
    );
  }

  const models =
    getTenantAccountingModels(connection);

  for (const name of [
    "Product",
    "StockMovement",
    "Warehouse",
    "WarehouseStock",
    "InventorySettings",
    "AuditLog",
  ]) {
    if (
      !models[name] ||
      models[name].db !== connection
    ) {
      throw createError(
        `Invalid tenant model: ${name}`,
        500,
      );
    }
  }

  return {
    connection,
    models,

    tenantId: objectId(
      tenant._id,
      "tenantId",
    ),

    userId: objectId(
      userId,
      "userId",
    ),
  };
};

const initializeWarehouseStock = async ({
  tenant,
  userId,
  ipAddress = null,
  confirmReconciled = false,
}) => {
  if (confirmReconciled !== true) {
    throw createError(
      "Explicit reconciliation confirmation is required",
    );
  }

  const context = resolveContext({
    tenant,
    userId,
  });

  const {
    connection,
    models,
    tenantId,
  } = context;

  const session =
    await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const settings =
        await models.InventorySettings.findOne({
          tenantId,
        }).session(session);

      if (!settings) {
        throw createError(
          "Inventory settings are missing. Provision warehouses first.",
          409,
        );
      }

      if (
        settings.warehouseTrackingStatus === "READY"
      ) {
        result = {
          initialized: false,
          alreadyInitialized: true,

          defaultWarehouseId:
            settings.defaultWarehouseId,

          warehouseTrackingStartedAt:
            settings.warehouseTrackingStartedAt,
        };

        return;
      }

      if (
        settings.warehouseTrackingStatus !==
        "NOT_INITIALIZED"
      ) {
        throw createError(
          "Unexpected warehouse tracking state",
          409,
        );
      }

      if (settings.multiWarehouseEnabled) {
        throw createError(
          "Disable multi-warehouse mode before initialization",
          409,
        );
      }

      const oldSettings =
        settings.toObject();

      const settingsLock =
        await models.InventorySettings.updateOne(
          {
            _id: settings._id,
            tenantId,
            __v: settings.__v,

            warehouseTrackingStatus:
              "NOT_INITIALIZED",

            multiWarehouseEnabled: false,
          },
          {
            $inc: {
              __v: 1,
            },
          },
          {
            session,
            timestamps: false,
          },
        );

      if (settingsLock.modifiedCount !== 1) {
        throw createError(
          "Inventory settings changed. Retry after checking the tenant state.",
          409,
        );
      }

      const warehouse =
        await models.Warehouse.findOne({
          _id: settings.defaultWarehouseId,
          tenantId,
          status: "ACTIVE",
        }).session(session);

      if (!warehouse) {
        throw createError(
          "Active default warehouse not found",
          409,
        );
      }

      warehouse.increment();

      await warehouse.save({
        session,
      });

      const existingBalance =
        await models.WarehouseStock.exists({
          tenantId,
        }).session(session);

      if (existingBalance) {
        throw createError(
          "Warehouse balances already exist while tracking is uninitialized. Reconcile the partial setup before continuing.",
          409,
        );
      }

      const allocatedMovement =
        await models.StockMovement.exists({
          tenantId,

          warehouseId: {
            $type: "objectId",
          },
        }).session(session);

      if (allocatedMovement) {
        throw createError(
          "Warehouse-linked movements already exist. Reconcile this tenant before initialization.",
          409,
        );
      }

      const products =
        await models.Product.find({
          tenantId,
        })
          .select(
            "_id productCode name type trackInventory currentStock status isDeleted",
          )
          .session(session)
          .lean();

      const productMap = new Map(
        products.map(
          (product) => [
            String(product._id),
            product,
          ],
        ),
      );

      const movementTotals = new Map();

      const cursor =
        models.StockMovement.find({
          tenantId,
        })
          .select(
            "_id productId quantity direction",
          )
          .session(session)
          .lean()
          .cursor();

      try {
        for await (const movement of cursor) {
          const productKey =
            String(movement.productId);

          if (!productMap.has(productKey)) {
            throw createError(
              `Movement ${movement._id} references a missing Product. Reconcile orphaned stock history first.`,
              409,
            );
          }

          if (
            !["IN", "OUT"].includes(
              movement.direction,
            )
          ) {
            throw createError(
              `Movement ${movement._id} has an invalid direction`,
              409,
            );
          }

          const quantity = quantityMilli(
            movement.quantity,
            `Movement ${movement._id}`,
            false,
          );

          const delta =
            movement.direction === "IN"
              ? BigInt(quantity)
              : -BigInt(quantity);

          movementTotals.set(
            productKey,

            (movementTotals.get(productKey) ?? 0n) +
              delta,
          );
        }
      } finally {
        await cursor.close();
      }

      const cutoverTime = new Date();

      const balanceDocuments = [];

      for (const product of products) {
        const productKey =
          String(product._id);

        const currentQuantity =
          quantityMilli(
            product.currentStock,
            `Product ${product.productCode}`,
          );

        const historyQuantity =
          movementTotals.get(productKey) ?? 0n;

        if (
          historyQuantity !==
          BigInt(currentQuantity)
        ) {
          throw createError(
            `Stock reconciliation failed for ${product.productCode}: Product stock does not match net stock movement history.`,
            409,
          );
        }

        const tracksInventory =
          product.type === "GOODS" &&
          product.trackInventory === true;

        if (!tracksInventory) {
          if (currentQuantity !== 0) {
            throw createError(
              `Non-inventory Product ${product.productCode} has a non-zero stock balance`,
              409,
            );
          }

          continue;
        }

        balanceDocuments.push({
          tenantId,

          warehouseId:
            warehouse._id,

          productId:
            product._id,

          currentStock:
            currentQuantity / 1000,

          initializationStock:
            currentQuantity / 1000,

          initializedAt:
            cutoverTime,
        });
      }

      const batchSize = 500;

      for (
        let index = 0;
        index < balanceDocuments.length;
        index += batchSize
      ) {
        await models.WarehouseStock.insertMany(
          balanceDocuments.slice(
            index,
            index + batchSize,
          ),
          {
            session,
            ordered: true,
          },
        );
      }

      const updatedSettings =
        await models.InventorySettings.findOne({
          _id: settings._id,
          tenantId,
        }).session(session);

      if (
        !updatedSettings ||
        updatedSettings.warehouseTrackingStatus !==
          "NOT_INITIALIZED" ||
        updatedSettings.multiWarehouseEnabled
      ) {
        throw createError(
          "Inventory settings changed during initialization",
          409,
        );
      }

      updatedSettings.warehouseTrackingStatus =
        "READY";

      updatedSettings.warehouseTrackingStartedAt =
        cutoverTime;

      updatedSettings.multiWarehouseEnabled =
        false;

      updatedSettings.updatedBy =
        context.userId;

      await updatedSettings.save({
        session,
      });

      await models.AuditLog.create(
        [
          {
            tenantId,
            userId: context.userId,
            action: "UPDATE",
            module: "WAREHOUSE",

            documentId:
              warehouse._id,

            oldData: {
              inventorySettings:
                oldSettings,
            },

            newData: {
              operation:
                "INITIALIZE_WAREHOUSE_STOCK",

              inventorySettings:
                updatedSettings.toObject(),

              defaultWarehouseId:
                warehouse._id,

              initializedBalanceCount:
                balanceDocuments.length,

              productStockChanged:
                false,

              stockMovementsCreated:
                0,
            },

            ipAddress,
          },
        ],
        {
          session,
        },
      );

      result = {
        initialized: true,
        alreadyInitialized: false,

        defaultWarehouseId:
          warehouse._id,

        initializedBalanceCount:
          balanceDocuments.length,

        warehouseTrackingStartedAt:
          cutoverTime,

        multiWarehouseEnabled:
          false,

        productStockChanged:
          false,

        stockMovementsCreated:
          0,
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  initializeWarehouseStock,
};