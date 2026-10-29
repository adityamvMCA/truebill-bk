// const {
//   getReadyTenantConnection,
// } = require("../../../tenancy/tenantConnectionManager");
// const {
//   getTenantAccountingModels,
// } = require("../../../tenancy/tenantAccountingModels");
// const core = require("./masterCore");

// module.exports = (kind) => {
//   const config = core.configurations[kind];
//   const routeKey = kind === "category" ? "categoryCode" : "brandId";

//   const resolve = (args) => {
//     if (!args.tenant?._id)
//       throw core.createError("Resolved tenant context is required", 500);
//     const connection = getReadyTenantConnection(args.tenant);
//     const models = getTenantAccountingModels(connection);
//     for (const key of [config.modelKey, "AuditLog"]) {
//       if (!models[key] || models[key].db !== connection)
//         throw core.createError(`Invalid tenant model: ${key}`, 500);
//     }
//     return {
//       ...args,
//       connection,
//       models,
//       tenantId: core.objectId(args.tenant._id, "tenantId"),
//     };
//   };
//   const transaction = async (args, operation) => {
//     const context = resolve(args);
//     context.userId = core.objectId(args.userId, "userId");
//     const session = await context.connection.startSession();
//     try {
//       let result;
//       await session.withTransaction(async () => {
//         result = await operation({ ...context, session });
//       });
//       return result;
//     } catch (error) {
//       if (error.code === 11000)
//         throw core.createError(
//           `${kind} name, code or default key already exists`,
//           409,
//         );
//       if (error.name === "VersionError")
//         throw core.createError(
//           `${kind} changed. Reload before continuing.`,
//           409,
//         );
//       throw error;
//     } finally {
//       await session.endSession();
//     }
//   };
//   const load = async (context) => {
//     const filter = { tenantId: context.tenantId };
//     if (kind === "category") {
//       const code = String(context[routeKey] ?? "")
//         .trim()
//         .toUpperCase();
//       if (!code || ["NULL", "UNDEFINED"].includes(code))
//         throw core.createError("A category code is required");
//       filter.categoryCode = code;
//     } else {
//       filter._id = core.objectId(context[routeKey], "brandId");
//     }
//     const record = await context.models[config.modelKey]
//       .findOne(filter)
//       .session(context.session ?? null);
//     if (!record) throw core.createError(`${kind} not found`, 404);
//     return record;
//   };
//   const create = (args) =>
//     transaction(args, async (context) => {
//       const document = await core.createRecord(
//         context,
//         config,
//         args.payload || {},
//       );
//       return document.toObject();
//     });
//   const get = async (args) => (await load(resolve(args))).toObject();
//   const list = async (args) => {
//     const { models, tenantId } = resolve(args);
//     const page = Number(args.page ?? 1);
//     const limit = Number(args.limit ?? 20);
//     const skip = (page - 1) * limit;
//     if (
//       !Number.isSafeInteger(page) ||
//       page < 1 ||
//       !Number.isSafeInteger(limit) ||
//       limit < 1 ||
//       limit > 100 ||
//       !Number.isSafeInteger(skip)
//     ) {
//       throw core.createError("Invalid pagination");
//     }
//     const filter = { tenantId };
//     if (args.status) {
//       if (!["ACTIVE", "INACTIVE"].includes(args.status))
//         throw core.createError("Invalid status");
//       filter.status = args.status;
//     }
//     const search = String(args.search ?? "").trim();
//     if (search) {
//       const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//       const regex = new RegExp(escaped, "i");
//       filter.$or = [
//         { [config.codeField]: regex },
//         { name: regex },
//         { description: regex },
//       ];
//     }
//     const [data, total] = await Promise.all([
//       models[config.modelKey]
//         .find(filter)
//         .sort({ name: 1, _id: 1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),
//       models[config.modelKey].countDocuments(filter),
//     ]);
//     return {
//       data,
//       pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
//     };
//   };
//   const update = (args) =>
//     transaction(args, async (context) => {
//       const payload = args.payload || {};
//       const editable = ["name", "description", "status"];
//       if (
//         Object.keys(payload).some(
//           (field) => !["version", ...editable].includes(field),
//         )
//       )
//         throw core.createError("Unsupported update fields");
//       const document = await load(context);
//       if (!Number.isSafeInteger(payload.version) || payload.version < 0)
//         throw core.createError("A valid document version is required");
//       if (document.__v !== payload.version)
//         throw core.createError(
//           `${kind} changed. Reload before continuing.`,
//           409,
//         );
//       if (!editable.some((field) => core.hasOwn(payload, field)))
//         throw core.createError("Provide at least one editable field");
//       const oldData = document.toObject();
//       if (core.hasOwn(payload, "name")) {
//         const name = core.normalizeName(payload.name);
//         if (!name || name.length > 100)
//           throw core.createError("Name must contain 1–100 characters");
//         document.name = name;
//         document.normalizedName = name.toLowerCase();
//       }
//       if (core.hasOwn(payload, "description")) {
//         const description = core.nullableText(payload.description);
//         if (description && description.length > 1000)
//           throw core.createError("Description cannot exceed 1000 characters");
//         document.description = description;
//       }
//       if (core.hasOwn(payload, "status")) {
//         if (!["ACTIVE", "INACTIVE"].includes(payload.status))
//           throw core.createError("Invalid status");
//         document.status = payload.status;
//       }
//       if (!document[config.codeField]) {
//         throw core.createError(
//           "This legacy record has no code. Run the protected seed-defaults migration first.",
//           409,
//         );
//       }
//       document.updatedBy = context.userId;
//       await document.save({ session: context.session });
//       await core.audit(context, config, document, "UPDATE", oldData);
//       return document.toObject();
//     });
//   const seedDefaults = async (args) => {
//     if (args.confirm !== true)
//       throw core.createError("Explicit confirmation is required");
//     const context = resolve(args);
//     core.objectId(args.userId, "userId");
//     for (const key of [config.modelKey, "AuditLog"]) {
//       try {
//         await context.models[key].createCollection();
//       } catch (error) {
//         if (error.code !== 48 && error.codeName !== "NamespaceExists")
//           throw error;
//       }
//       await context.models[key].createIndexes();
//     }
//     return transaction(args, (transactionContext) =>
//       core.seedKind(transactionContext, config),
//     );
//   };
//   return { create, get, list, update, seedDefaults };
// };



const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const core = require("./masterCore");

module.exports = (kind) => {
  const config = core.configurations[kind];

  if (!config) {
    throw new Error(`Invalid master service kind: ${kind}`);
  }

  const routeKey = kind === "category" ? "categoryCode" : "brandId";

  const resolve = (args) => {
    if (!args.tenant?._id) {
      throw core.createError("Resolved tenant context is required", 500);
    }

    const connection = getReadyTenantConnection(args.tenant);
    const models = getTenantAccountingModels(connection);

    for (const key of [config.modelKey, "AuditLog"]) {
      if (!models[key] || models[key].db !== connection) {
        throw core.createError(`Invalid tenant model: ${key}`, 500);
      }
    }

    return {
      ...args,
      connection,
      models,
      tenantId: core.objectId(args.tenant._id, "tenantId"),
    };
  };

  const transaction = async (args, operation) => {
    const context = resolve(args);
    context.userId = core.objectId(args.userId, "userId");

    const session = await context.connection.startSession();

    try {
      let result;

      await session.withTransaction(async () => {
        result = await operation({ ...context, session });
      });

      return result;
    } catch (error) {
      if (error.code === 11000) {
        throw core.createError(
          `${kind} name, code or default key already exists`,
          409,
        );
      }

      if (error.name === "VersionError") {
        throw core.createError(
          `${kind} changed. Reload before continuing.`,
          409,
        );
      }

      throw error;
    } finally {
      await session.endSession();
    }
  };

  const load = async (context) => {
    const filter = { tenantId: context.tenantId };

    if (kind === "category") {
      const code = String(context[routeKey] ?? "")
        .trim()
        .toUpperCase();

      if (!code || ["NULL", "UNDEFINED"].includes(code)) {
        throw core.createError("A category code is required");
      }

      filter.categoryCode = code;
    } else {
      filter._id = core.objectId(context[routeKey], "brandId");
    }

    const record = await context.models[config.modelKey]
      .findOne(filter)
      .session(context.session ?? null);

    if (!record) {
      throw core.createError(`${kind} not found`, 404);
    }

    return record;
  };

  // CREATE
  const create = (args) =>
    transaction(args, async (context) => {
      const document = await core.createRecord(
        context,
        config,
        args.payload || {},
      );

      return document.toObject();
    });

  // GET SINGLE RECORD
  const get = async (args) => {
    return (await load(resolve(args))).toObject();
  };

  // LIST: PAGINATION, SEARCH, FILTERING AND SORTING
  const list = async (args) => {
    const { models, tenantId } = resolve(args);

    const page = Number(args.page ?? 1);
    const limit = Number(args.limit ?? 20);
    const skip = (page - 1) * limit;

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(skip)
    ) {
      throw core.createError("Invalid pagination");
    }

    // Always scope queries to the current tenant.
    const filter = { tenantId };

    if (args.status) {
      if (!["ACTIVE", "INACTIVE"].includes(args.status)) {
        throw core.createError("Invalid status");
      }

      filter.status = args.status;
    }

    // Search
    const search = String(args.search ?? "").trim();

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");

      filter.$or = [
        { [config.codeField]: regex },
        { name: regex },
        { description: regex },
      ];
    }

    // Default: newest-created records first.
    const sortBy = String(args.sortBy ?? "createdAt").trim();
    const sortOrder = String(args.sortOrder ?? "desc")
      .trim()
      .toLowerCase();

    const allowedSortFields = new Set([
      "name",
      "status",
      "createdAt",
      "updatedAt",
      config.codeField,
    ]);

    if (!allowedSortFields.has(sortBy)) {
      throw core.createError("Invalid sort field");
    }

    if (!["asc", "desc"].includes(sortOrder)) {
      throw core.createError("Invalid sort order");
    }

    const sortOptions = {
      [sortBy]: sortOrder === "desc" ? -1 : 1,
      _id: -1,
    };

    const [data, total] = await Promise.all([
      models[config.modelKey]
        .find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),

      models[config.modelKey].countDocuments(filter),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  // BULK STATUS UPDATE
  // Preserves the existing categoryCodes payload contract.
  const bulkUpdateStatus = (args) =>
    transaction(args, async (context) => {
      if (kind !== "category") {
        throw core.createError(
          "Bulk status update is not configured for this master type",
          400,
        );
      }

      const rawCodes = args.categoryCodes;

      if (
        !Array.isArray(rawCodes) ||
        rawCodes.length < 1 ||
        rawCodes.length > 100
      ) {
        throw core.createError("Select between 1 and 100 categories");
      }

      const codes = [
        ...new Set(
          rawCodes
            .map((code) =>
              String(code ?? "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean),
        ),
      ];

      if (!codes.length) {
        throw core.createError("No valid category codes were supplied");
      }

      const status = String(args.status ?? "")
        .trim()
        .toUpperCase();

      if (!["ACTIVE", "INACTIVE"].includes(status)) {
        throw core.createError("Status must be ACTIVE or INACTIVE");
      }

      const documents = await context.models[config.modelKey]
        .find({
          tenantId: context.tenantId,
          [config.codeField]: { $in: codes },
        })
        .session(context.session);

      if (documents.length !== codes.length) {
        throw core.createError(
          "Some selected categories were not found. Refresh the list and try again.",
          404,
        );
      }

      let affectedCount = 0;

      for (const document of documents) {
        if (document.status === status) {
          continue;
        }

        const oldData = document.toObject();

        document.status = status;
        document.updatedBy = context.userId;

        await document.save({ session: context.session });

        await core.audit(
          context,
          config,
          document,
          "UPDATE",
          oldData,
        );

        affectedCount += 1;
      }

      return {
        status,
        affectedCount,
        requestedCount: codes.length,
      };
    });

  // UPDATE
  const update = (args) =>
    transaction(args, async (context) => {
      const payload = args.payload || {};
      const editable = ["name", "description", "status"];

      if (
        Object.keys(payload).some(
          (field) => !["version", ...editable].includes(field),
        )
      ) {
        throw core.createError("Unsupported update fields");
      }

      const document = await load(context);

      if (
        !Number.isSafeInteger(payload.version) ||
        payload.version < 0
      ) {
        throw core.createError("A valid document version is required");
      }

      if (document.__v !== payload.version) {
        throw core.createError(
          `${kind} changed. Reload before continuing.`,
          409,
        );
      }

      if (!editable.some((field) => core.hasOwn(payload, field))) {
        throw core.createError("Provide at least one editable field");
      }

      const oldData = document.toObject();

      if (core.hasOwn(payload, "name")) {
        const name = core.normalizeName(payload.name);

        if (!name || name.length > 100) {
          throw core.createError("Name must contain 1–100 characters");
        }

        document.name = name;
        document.normalizedName = name.toLowerCase();
      }

      if (core.hasOwn(payload, "description")) {
        const description = core.nullableText(payload.description);

        if (description && description.length > 1000) {
          throw core.createError(
            "Description cannot exceed 1000 characters",
          );
        }

        document.description = description;
      }

      if (core.hasOwn(payload, "status")) {
        if (!["ACTIVE", "INACTIVE"].includes(payload.status)) {
          throw core.createError("Invalid status");
        }

        document.status = payload.status;
      }

      if (!document[config.codeField]) {
        throw core.createError(
          "This legacy record has no code. Run the protected seed-defaults migration first.",
          409,
        );
      }

      document.updatedBy = context.userId;

      await document.save({ session: context.session });

      await core.audit(
        context,
        config,
        document,
        "UPDATE",
        oldData,
      );

      return document.toObject();
    });

  // SEED DEFAULTS
  const seedDefaults = async (args) => {
    if (args.confirm !== true) {
      throw core.createError("Explicit confirmation is required");
    }

    const context = resolve(args);
    core.objectId(args.userId, "userId");

    for (const key of [config.modelKey, "AuditLog"]) {
      try {
        await context.models[key].createCollection();
      } catch (error) {
        if (error.code !== 48 && error.codeName !== "NamespaceExists") {
          throw error;
        }
      }

      await context.models[key].createIndexes();
    }

    return transaction(args, (transactionContext) =>
      core.seedKind(transactionContext, config),
    );
  };

  return {
    create,
    get,
    list,
    update,
    seedDefaults,
    bulkUpdateStatus,
  };
};
