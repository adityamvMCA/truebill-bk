const service = require("./warehouse.service");
const stockMovementService = require("../../stock-movements/stockMovement.service");
const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  warehouseCode: req.validatedParams?.warehouseCode,
  payload: req.validatedBody,
});

const {
  provisionWarehousesForTenant,
} = require("../../../tenancy/provisionTenantDatabase");
const initializeStock = async (req, res, next) => {
  try {
    const body = req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      body.confirm !== true ||
      Object.keys(body).some((field) => field !== "confirm")
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Send exactly {"confirm": true} to initialize warehouse stock.',
      });
    }

    const data = await stockMovementService.initializeWarehouseStock({
      tenant: req.tenant,
      userId: req.user.userId,
      ipAddress: req.ip,
      confirm: true,
    });

    return res.status(200).json({
      success: true,

      message: data.alreadyInitialized
        ? "Warehouse stock is already initialized"
        : "Warehouse stock initialized successfully",

      data,
    });
  } catch (error) {
    return next(error);
  }
};
const setupWarehouses = async (req, res, next) => {
  try {
    if (!req.tenant?._id) {
      const error = new Error("Resolved tenant context is required");

      error.statusCode = 400;
      throw error;
    }

    if (!req.user?.userId) {
      const error = new Error("Authenticated user context is required");

      error.statusCode = 401;
      throw error;
    }

    await provisionWarehousesForTenant({
      tenant: req.tenant,
      userId: req.user.userId,
    });

    const settings = await service.getInventorySettings({
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      message: "Warehouse setup completed and verified successfully",

      data: {
        tenantId: String(req.tenant._id),
        warehouse: settings.defaultWarehouse,
        settings,
      },
    });
  } catch (error) {
    console.error("[warehouse.setup.failed]", {
      tenantId: String(req.tenant?._id ?? ""),
      databaseName: req.tenant?.databaseName,
      message: error.message,
    });

    return next(error);
  }
};
const createWarehouse = async (req, res, next) => {
  try {
    const data = await service.createWarehouse(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Warehouse created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listWarehouses = async (req, res, next) => {
  try {
    const result = await service.listWarehouses({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return next(error);
  }
};

const getWarehouse = async (req, res, next) => {
  try {
    const data = await service.getWarehouse(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateWarehouse = async (req, res, next) => {
  try {
    const data = await service.updateWarehouse(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Warehouse updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const getInventorySettings = async (req, res, next) => {
  try {
    const data = await service.getInventorySettings({
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createWarehouse,
  listWarehouses,
  getWarehouse,
  updateWarehouse,
  getInventorySettings,
  setupWarehouses,
  initializeStock,
};
