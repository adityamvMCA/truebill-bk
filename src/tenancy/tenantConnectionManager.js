const mongoose = require("mongoose");

const { assertTenantDatabaseName } = require("./tenantDatabaseNames");

const createError = (message, statusCode = 503) => {
  const error = new Error(message);

  error.statusCode = statusCode;

  return error;
};

const assertFeatureEnabled = () => {
  if (process.env.TENANT_DATABASES_ENABLED !== "true") {
    throw createError("Dedicated tenant databases are not enabled");
  }
};

const getMainConnection = () => {
  const connection = mongoose.connection;

  if (connection.readyState !== 1 || !connection.db) {
    throw createError("Main database connection is unavailable");
  }

  return connection;
};

const getConnection = (tenant) => {
  if (!tenant?._id || !mongoose.isObjectIdOrHexString(tenant._id)) {
    throw createError("A valid tenant context is required", 400);
  }

  if (tenant.isActive !== true) {
    throw createError("Tenant is inactive", 403);
  }

  if (["suspended", "cancelled"].includes(tenant.status)) {
    throw createError("Tenant access is disabled", 403);
  }

  if (tenant.storageMode !== "DEDICATED") {
    throw createError("Tenant is not configured for dedicated storage", 409);
  }

  let databaseName;

  try {
    databaseName = assertTenantDatabaseName({
      databaseKey: tenant.databaseKey,
      databaseName: tenant.databaseName,
    });
  } catch (error) {
    throw createError(error.message, 409);
  }

  const mainConnection = getMainConnection();

  if (
    databaseName === mainConnection.name ||
    ["admin", "config", "local"].includes(databaseName)
  ) {
    throw createError("Invalid tenant database target", 409);
  }

  return mainConnection.useDb(databaseName, {
    useCache: true,
  });
};

const getReadyTenantConnection = (tenant) => {
  assertFeatureEnabled();

  if (tenant?.provisioningStatus !== "READY") {
    throw createError("Tenant database is not ready", 409);
  }

  return getConnection(tenant);
};

const getProvisioningConnection = (tenant) => {
  assertFeatureEnabled();

  if (tenant?.provisioningStatus !== "PROVISIONING") {
    throw createError("Tenant is not in provisioning state", 409);
  }

  return getConnection(tenant);
};

module.exports = {
  getReadyTenantConnection,
  getProvisioningConnection,
};
