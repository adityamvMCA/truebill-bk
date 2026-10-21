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

// Trim strings and drop empty values so Joi defaults apply
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
  modelKey, // key returned by getTenantAccountingModels, e.g. "Supplier"
  maxRecords = 5000,
  chunkSize = 500,
  schema, // Joi schema used per row
  transformRow = (row) => row,
  uniqueFields = [], // fields unique in the main model, e.g. ["gstNo"]
  baseFilter = {}, // e.g. { isDeleted: false }

  /*
    Values that must be unique in ANOTHER collection, e.g. ledger names.
    Each rule: {
      modelKey: "Ledger",
      field: "name",
      label: "ledger name",
      getValue: (data) => data.customerName,
      filter: {},   // optional extra query filter
      hint: "...",  // optional text appended to the error
    }
  */
  externalUniques = [],

  prepare = async () => ({}), // runs once per request
  reserveCodes, // async ({ count, tenant, connection }) => string[]
  buildChunk, // ({ items, ctx, models, tenantId, userId, ipAddress }) => [{ model, docs }]
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

      const tenant = req.tenant;
      const tenantId = tenant._id;
      const userId = req.user.userId;

      const connection = getReadyTenantConnection(tenant);
      const models = getTenantAccountingModels(connection);
      const Model = models[modelKey];

      const offset = Number(rowOffset) || 0;
      const errors = [];
      let createdCount = 0;

      /* 1. VALIDATE EVERY ROW IN MEMORY */

      let candidates = [];

      rows.forEach((raw, index) => {
        const rowNumber = offset + index + 2; // +2 = header row + 1-based

        const { error, value } = schema.validate(
          transformRow(cleanRow(raw)),
          { abortEarly: false, stripUnknown: true, convert: true },
        );

        if (error) {
          errors.push({
            row: rowNumber,
            message: error.details.map((d) => d.message).join("; "),
          });
          return;
        }

        candidates.push({ rowNumber, data: value });
      });

      /* 2. DUPLICATES: INSIDE THE FILE + ALREADY IN DATABASE */

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
          ...new Set(unique.map((i) => i.data[field]).filter(Boolean)),
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
          existing.map((doc) => String(doc[field]).toUpperCase()),
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

      /* 2b. VALUES THAT MUST BE UNIQUE IN ANOTHER COLLECTION (e.g. ledger names) */

      for (const rule of externalUniques) {
        const TargetModel = models[rule.modelKey];

        // duplicates inside the file
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

        // already in the database
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

        const existingSet = new Set(existing.map((doc) => doc[rule.field]));

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

      /* 3. PREPARE ONCE, RESERVE CODES, WRITE IN CHUNKS */

      if (candidates.length > 0) {
        // Runs before codes are reserved, so a setup error burns no sequence numbers
        const ctx = await prepare({ models, tenantId });

        const codes = await reserveCodes({
          count: candidates.length,
          tenant,
          connection,
        });

        candidates.forEach((item, i) => {
          item.code = codes[i];
        });

        session = await connection.startSession();

        for (const part of chunk(candidates, chunkSize)) {
          try {
            await session.withTransaction(async () => {
              const writes = buildChunk({
                items: part,
                ctx,
                models,
                tenantId,
                userId,
                ipAddress: req.ip,
              });

              for (const { model, docs } of writes) {
                await model.insertMany(docs, { session });
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
      next(error);
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  };
};

module.exports = { createBulkImportHandler };