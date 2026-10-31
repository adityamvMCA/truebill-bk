const {
  getTenantAccountingModels,
} = require("../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../tenancy/tenantConnectionManager");

const chunk = (items, size) => {
  const parts = [];

  for (let i = 0; i < items.length; i += size) {
    parts.push(items.slice(i, i + size));
  }

  return parts;
};

const cleanRow = (row) => {
  const cleaned = {};

  for (const [key, value] of Object.entries(row || {})) {
    const next = typeof value === "string" ? value.trim() : value;

    if (next !== "" && next !== null && next !== undefined) {
      cleaned[key] = next;
    }
  }

  return cleaned;
};

const createBulkImportHandler = ({
  label = "record",
  modelKey,
  maxRecords = 5000,
  chunkSize = 500,
  schema,
  transformRow = (row) => row,
  uniqueFields = [],
  baseFilter = {},
  externalUniques = [],
  prepare = async () => ({}),
  reserveCodes,
  buildChunk,
}) => {
  return async (req, res, next) => {
    let session;

    try {
      const { rows, rowOffset = 0 } = req.body || {};

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: '"rows" array is required and must not be empty',
        });
      }

      if (rows.length > maxRecords) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${maxRecords} rows allowed per request`,
        });
      }

      if (!req.tenant?._id || !req.user?.userId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated tenant and user context are required",
        });
      }

      if (typeof schema?.validate !== "function") {
        throw new Error(`A valid validation schema is required for ${label} import`);
      }

      if (typeof buildChunk !== "function") {
        throw new Error(`buildChunk function is required for ${label} import`);
      }

      const tenant = req.tenant;
      const tenantId = tenant._id;
      const userId = req.user.userId;

      const connection = getReadyTenantConnection(tenant);
      const models = getTenantAccountingModels(connection);
      const Model = models[modelKey];

      if (!Model) {
        throw new Error(`Model "${modelKey}" is not registered for this tenant`);
      }

      const offset = Number(rowOffset) || 0;
      const errors = [];
      let createdCount = 0;

      let candidates = [];

      rows.forEach((raw, index) => {
        const rowNumber = offset + index + 2;

        const { error, value } = schema.validate(
          transformRow(cleanRow(raw)),
          {
            abortEarly: false,
            stripUnknown: true,
            convert: true,
          }
        );

        if (error) {
          errors.push({
            row: rowNumber,
            message: error.details.map((detail) => detail.message).join("; "),
          });

          return;
        }

        candidates.push({
          rowNumber,
          data: value,
        });
      });

      for (const field of uniqueFields) {
        const seen = new Set();
        const unique = [];

        for (const item of candidates) {
          const value = item.data[field];

          if (!value) {
            unique.push(item);
            continue;
          }

          const key = String(value).toUpperCase();

          if (seen.has(key)) {
            errors.push({
              row: item.rowNumber,
              message: `Duplicate ${field} in file: ${value}`,
            });

            continue;
          }

          seen.add(key);
          unique.push(item);
        }

        const values = [
          ...new Set(unique.map((item) => item.data[field]).filter(Boolean)),
        ];

        const existing = values.length
          ? await Model.find({
              tenantId,
              ...baseFilter,
              [field]: { $in: values },
            })
              .select(field)
              .lean()
          : [];

        const existingSet = new Set(
          existing.map((doc) => String(doc[field]).toUpperCase())
        );

        candidates = unique.filter((item) => {
          const value = item.data[field];

          if (value && existingSet.has(String(value).toUpperCase())) {
            errors.push({
              row: item.rowNumber,
              message: `${field} already exists: ${value}`,
            });

            return false;
          }

          return true;
        });
      }

      for (const rule of externalUniques) {
        const TargetModel = models[rule.modelKey];

        if (!TargetModel) {
          throw new Error(
            `External unique model "${rule.modelKey}" is not registered`
          );
        }

        const seen = new Set();
        const unique = [];

        for (const item of candidates) {
          const value = rule.getValue(item.data);

          if (!value) {
            unique.push(item);
            continue;
          }

          if (seen.has(value)) {
            errors.push({
              row: item.rowNumber,
              message: `Duplicate ${rule.label} in file: ${value}`,
            });

            continue;
          }

          seen.add(value);
          unique.push(item);
        }

        const values = [...seen];

        const existing = values.length
          ? await TargetModel.find({
              tenantId,
              ...(rule.filter || {}),
              [rule.field]: { $in: values },
            })
              .select(rule.field)
              .lean()
          : [];

        const existingSet = new Set(
          existing.map((doc) => doc[rule.field])
        );

        candidates = unique.filter((item) => {
          const value = rule.getValue(item.data);

          if (value && existingSet.has(value)) {
            errors.push({
              row: item.rowNumber,
              message: `${rule.label} "${value}" already exists${
                rule.hint ? ` (${rule.hint})` : ""
              }`,
            });

            return false;
          }

          return true;
        });
      }

      if (candidates.length > 0) {
        const ctx = await prepare({
          models,
          tenantId,
          tenant,
          userId,
        });

        if (typeof reserveCodes === "function") {
          const codes = await reserveCodes({
            count: candidates.length,
            tenant,
            connection,
            models,
            tenantId,
            userId,
            ctx,
          });

          if (!Array.isArray(codes) || codes.length < candidates.length) {
            throw new Error(
              `Code reservation must return at least ${candidates.length} codes`
            );
          }

          candidates.forEach((item, index) => {
            item.code = codes[index];
          });
        }

        session = await connection.startSession();

        for (const part of chunk(candidates, chunkSize)) {
          try {
            await session.withTransaction(async () => {
              const writes = await buildChunk({
                items: part,
                ctx,
                models,
                tenantId,
                userId,
                ipAddress: req.ip,
              });

              if (!Array.isArray(writes)) {
                throw new Error(
                  `buildChunk must return an array for ${label} import`
                );
              }

              for (const write of writes) {
                if (!write?.model || !Array.isArray(write.docs)) {
                  throw new Error(
                    `Invalid bulk write configuration for ${label} import`
                  );
                }

                if (write.docs.length > 0) {
                  await write.model.insertMany(write.docs, {
                    session,
                    ordered: true,
                  });
                }
              }
            });

            createdCount += part.length;
          } catch (error) {
            console.error(`Bulk ${label} chunk failed:`, error);

            part.forEach((item) => {
              errors.push({
                row: item.rowNumber,
                message: error.message || `Unable to save ${label}`,
              });
            });
          }
        }
      }

      errors.sort((a, b) => a.row - b.row);

      return res.status(200).json({
        success: true,
        message: `${createdCount} ${label}(s) imported`,
        total: rows.length,
        createdCount,
        failedCount: errors.length,
        errors,
      });
    } catch (error) {
      if (typeof next === "function") {
        return next(error);
      }

      console.error(`Bulk ${label} import failed:`, error);

      return res.status(500).json({
        success: false,
        message: error.message || `Unable to import ${label}`,
      });
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  };
};

module.exports = {
  createBulkImportHandler,
};