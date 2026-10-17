const DATABASE_PREFIX = "trustiq_tenant_";

// Compatibility limit for the current deployment.
const MAX_DATABASE_NAME_BYTES = 38;

const MAX_DATABASE_KEY_LENGTH =
  MAX_DATABASE_NAME_BYTES -
  Buffer.byteLength(DATABASE_PREFIX, "utf8");

const DATABASE_KEY_REGEX =
  /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const validateDatabaseKey = (value) => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_DATABASE_KEY_LENGTH ||
    !DATABASE_KEY_REGEX.test(value)
  ) {
    throw new Error(
      `Database key must be 1–${MAX_DATABASE_KEY_LENGTH} characters using lowercase letters, numbers, and single underscores between words`,
    );
  }

  return value;
};

const getTenantDatabaseName = (databaseKey) => {
  const key = validateDatabaseKey(databaseKey);

  const databaseName =
    `${DATABASE_PREFIX}${key}`;

  if (
    Buffer.byteLength(databaseName, "utf8") >
    MAX_DATABASE_NAME_BYTES
  ) {
    throw new Error(
      `Tenant database name must not exceed ${MAX_DATABASE_NAME_BYTES} bytes`,
    );
  }

  return databaseName;
};

const assertTenantDatabaseName = ({
  databaseKey,
  databaseName,
}) => {
  const expected = getTenantDatabaseName(
    databaseKey,
  );

  if (
    typeof databaseName !== "string" ||
    databaseName !== expected
  ) {
    throw new Error(
      "Tenant database mapping is invalid",
    );
  }

  return databaseName;
};

module.exports = {
  DATABASE_PREFIX,
  MAX_DATABASE_NAME_BYTES,
  MAX_DATABASE_KEY_LENGTH,
  validateDatabaseKey,
  getTenantDatabaseName,
  assertTenantDatabaseName,
};