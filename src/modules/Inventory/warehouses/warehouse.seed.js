const mongoose = require("mongoose");

const seedDefaultWarehouse = async ({
  models,
  tenantId,
  userId = null,
  session,
}) => {
  const { Warehouse, InventorySettings } = models || {};

  if (
    !Warehouse ||
    !InventorySettings ||
    Warehouse.db !== InventorySettings.db
  ) {
    throw new Error(
      "Warehouse and InventorySettings must use the same tenant connection",
    );
  }

  if (!mongoose.isObjectIdOrHexString(tenantId)) {
    throw new Error("A valid tenantId is required");
  }

  if (!session || !session.inTransaction()) {
    throw new Error(
      "Default warehouse provisioning requires an active transaction",
    );
  }

  const warehouse = await Warehouse.findOneAndUpdate(
    {
      tenantId,
      warehouseCode: "MAIN",
    },
    {
      $setOnInsert: {
        tenantId,
        warehouseCode: "MAIN",
        name: "Main Location",
        normalizedName: "main location",
        address: null,
        description: "Default inventory location",
        status: "ACTIVE",
        isSystem: true,
        createdBy: userId,
        updatedBy: userId,
        __v: 0,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      session,
    },
  );

  const settings = await InventorySettings.findOneAndUpdate(
    {
      tenantId,
    },
    {
      $setOnInsert: {
        tenantId,
        defaultWarehouseId: warehouse._id,
        multiWarehouseEnabled: false,
        warehouseTrackingStatus: "NOT_INITIALIZED",
        warehouseTrackingStartedAt: null,
        updatedBy: userId,
        __v: 0,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      session,
    },
  );

  const defaultWarehouse = await Warehouse.findOne({
    _id: settings.defaultWarehouseId,
    tenantId,
    status: "ACTIVE",
  })
    .session(session)
    .lean();

  if (!defaultWarehouse) {
    throw new Error(
      "Inventory settings reference a missing or inactive default warehouse",
    );
  }

  return {
    defaultWarehouse,
    settings: settings.toObject(),
  };
};

module.exports = {
  seedDefaultWarehouse,
};
