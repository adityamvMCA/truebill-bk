// const {
//   getTenantAccountingModels,
// } = require("../../tenancy/tenantAccountingModels");

// const {
//   getReadyTenantConnection,
// } = require("../../tenancy/tenantConnectionManager");

// const { getNextSequence } = require("../../utils/sequenceGenerator");

// const NotificationService = require("../../services/notificationService");

// const NORMAL_BALANCE_BY_NATURE = {
//   ASSET: "DEBIT",
//   EXPENSE: "DEBIT",
//   LIABILITY: "CREDIT",
//   INCOME: "CREDIT",
//   EQUITY: "CREDIT",
// };

// const createSupplierLedger = async ({
//   models,
//   tenantId,
//   userId,
//   supplier,
//   session,
// }) => {
//   const { Ledger, LedgerGroup } = models;

//   const sundryCreditorsGroup = await LedgerGroup.findOne({
//     tenantId,
//     code: "SUNDRY_CREDITORS",
//     isActive: true,
//   })
//     .session(session)
//     .lean();

//   if (!sundryCreditorsGroup) {
//     const error = new Error(
//       "Sundry Creditors ledger group is missing. Seed accounting groups before creating suppliers.",
//     );

//     error.statusCode = 400;

//     throw error;
//   }

//   const normalBalance =
//     NORMAL_BALANCE_BY_NATURE[sundryCreditorsGroup.nature];

//   if (!normalBalance) {
//     const error = new Error(
//       "Sundry Creditors ledger group has an invalid account nature.",
//     );

//     error.statusCode = 400;

//     throw error;
//   }

//   const ledgerCode = `SUPP-${supplier.supplierCode}`.toUpperCase();

//   const openingBalance = Number(supplier.openingBalance) || 0;

//   const ledgers = await Ledger.create(
//     [
//       {
//         tenantId,

//         ledgerGroupId: sundryCreditorsGroup._id,

//         code: ledgerCode,

//         name: supplier.supplierName,

//         type: "SUPPLIER",

//         nature: sundryCreditorsGroup.nature,

//         normalBalance,

//         openingBalance,

//         openingBalanceType: supplier.openingBalanceType || normalBalance,

//         currentBalance: openingBalance,

//         currentBalanceType: supplier.openingBalanceType || normalBalance,

//         referenceType: "SUPPLIER",

//         referenceId: supplier._id,

//         creditLimit: Number(supplier.creditLimit) || 0,

//         creditDays: Number(supplier.creditDays) || 0,

//         isSystem: false,

//         isActive: supplier.status === "Active",

//         description: `Supplier ledger for ${supplier.supplierName} (${supplier.supplierCode})`,

//         createdBy: userId,

//         updatedBy: userId,
//       },
//     ],
//     { session },
//   );

//   return ledgers[0];
// };

// const createSupplier = async ({
//   tenant,
//   userId,
//   payload,
//   ipAddress,
// }) => {
//   const connection = getReadyTenantConnection(tenant);

//   const models = getTenantAccountingModels(connection);

//   const { Supplier, AuditLog } = models;

//   const tenantId = tenant._id;

//   const session = await connection.startSession();

//   try {
//     let createdSupplier;

//     await session.withTransaction(async () => {
//       const supplierCode = await getNextSequence(
//         "SU",
//         tenantId.toString(),
//         3,
//         {
//           connection,
//           session,
//         },
//       );

//       const supplierRecords = await Supplier.create(
//         [
//           {
//             ...payload,
//             supplierCode,
//             tenantId,

//             payableBalance:
//               payload.openingBalanceType === "CREDIT"
//                 ? Number(payload.openingBalance) || 0
//                 : 0,
//           },
//         ],
//         { session },
//       );

//       const supplier = supplierRecords[0];

//       const ledger = await createSupplierLedger({
//         models,
//         tenantId,
//         userId,
//         supplier,
//         session,
//       });

//       supplier.ledgerId = ledger._id;

//       await supplier.save({ session });

//       await AuditLog.create(
//         [
//           {
//             tenantId,
//             userId,
//             action: "CREATE",
//             module: "SUPPLIER",
//             documentId: supplier._id,
//             newData: supplier.toObject(),
//             ipAddress,
//           },
//         ],
//         { session },
//       );

//       createdSupplier = supplier;
//     });

//     /*
//       Keep this notification only if NEW_SUPPLIER
//       exists in preferenceMap and preference schema.
//     */
//     await NotificationService.createForTenant({
//       tenantId,
//       type: "NEW_SUPPLIER",
//       title: "New supplier created",
//       message: `${createdSupplier.supplierName} (${createdSupplier.supplierCode}) was added successfully.`,
//       icon: "truck",
//       priority: "NORMAL",
//       route: `/suppliers/code/${createdSupplier.supplierCode}`,
//       data: {
//         supplierId: createdSupplier._id.toString(),
//         supplierCode: createdSupplier.supplierCode,
//         ledgerId: createdSupplier.ledgerId?.toString() || null,
//       },
//     });

//     return createdSupplier;
//   } finally {
//     await session.endSession();
//   }
// };

// const getSuppliers = async ({
//   tenant,
//   search = "",
//   status,
//   page = 1,
//   limit = 20,
// }) => {
//   const connection = getReadyTenantConnection(tenant);

//   const { Supplier } = getTenantAccountingModels(connection);

//   const tenantId = tenant._id;

//   const currentPage = Math.max(Number(page) || 1, 1);

//   const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

//   const filter = {
//     tenantId,
//     isDeleted: false,
//   };

//   if (status) {
//     filter.status = status;
//   }

//   const searchText = String(search || "").trim();

//   if (searchText) {
//     filter.$or = [
//       {
//         supplierName: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },
//       {
//         supplierCode: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },
//       {
//         phone: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },
//       {
//         email: {
//           $regex: searchText,
//           $options: "i",
//         },
//       },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     Supplier.find(filter)
//       .sort({ createdAt: -1 })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     Supplier.countDocuments(filter),
//   ]);

//   return {
//     data,
//     pagination: {
//       page: currentPage,
//       limit: pageLimit,
//       total,
//       totalPages: Math.ceil(total / pageLimit),
//     },
//   };
// };

// const getSupplierByCode = async ({
//   tenant,
//   supplierCode,
// }) => {
//   const connection = getReadyTenantConnection(tenant);

//   const { Supplier } = getTenantAccountingModels(connection);

//   const tenantId = tenant._id;

//   return Supplier.findOne({
//     supplierCode: String(supplierCode).trim().toUpperCase(),

//     tenantId,

//     isDeleted: false,
//   });
// };

// const updateSupplier = async ({
//   tenant,
//   userId,
//   supplierCode,
//   payload,
//   ipAddress,
// }) => {
//   const connection = getReadyTenantConnection(tenant);

//   const {
//     Supplier,
//     Ledger,
//     AuditLog,
//   } = getTenantAccountingModels(connection);

//   const tenantId = tenant._id;

//   const session = await connection.startSession();

//   try {
//     let updatedSupplier;

//     await session.withTransaction(async () => {
//       const supplier = await Supplier.findOne({
//         supplierCode: String(supplierCode).trim().toUpperCase(),

//         tenantId,

//         isDeleted: false,
//       }).session(session);

//       if (!supplier) {
//         const error = new Error("Supplier not found");

//         error.statusCode = 404;

//         throw error;
//       }

//       const oldData = supplier.toObject();

//       const protectedFields = [
//         "_id",
//         "tenantId",
//         "supplierCode",
//         "ledgerId",
//         "payableBalance",
//         "isDeleted",
//         "deletedAt",
//         "deletedBy",
//         "createdAt",
//         "updatedAt",
//         "__v",
//       ];

//       for (const [key, value] of Object.entries(payload || {})) {
//         if (!protectedFields.includes(key)) {
//           supplier[key] = value;
//         }
//       }

//       await supplier.save({ session });

//       if (supplier.ledgerId) {
//         const ledger = await Ledger.findOneAndUpdate(
//           {
//             _id: supplier.ledgerId,
//             tenantId,
//             type: "SUPPLIER",
//             referenceType: "SUPPLIER",
//             referenceId: supplier._id,
//           },
//           {
//             $set: {
//               name: supplier.supplierName,
//               creditLimit: Number(supplier.creditLimit) || 0,
//               creditDays: Number(supplier.creditDays) || 0,
//               isActive: supplier.status === "Active",
//               description: `Supplier ledger for ${supplier.supplierName} (${supplier.supplierCode})`,
//               updatedBy: userId,
//             },
//           },
//           {
//             new: true,
//             session,
//           },
//         );

//         if (!ledger) {
//           const error = new Error("Linked supplier ledger was not found.");

//           error.statusCode = 409;

//           throw error;
//         }
//       }

//       await AuditLog.create(
//         [
//           {
//             tenantId,
//             userId,
//             action: "UPDATE",
//             module: "SUPPLIER",
//             documentId: supplier._id,
//             oldData,
//             newData: supplier.toObject(),
//             ipAddress,
//           },
//         ],
//         { session },
//       );

//       updatedSupplier = supplier;
//     });

//     return updatedSupplier;
//   } finally {
//     await session.endSession();
//   }
// };

// const deleteSupplier = async ({
//   tenant,
//   userId,
//   supplierCode,
//   ipAddress,
// }) => {
//   const connection = getReadyTenantConnection(tenant);

//   const {
//     Supplier,
//     Ledger,
//     AuditLog,
//   } = getTenantAccountingModels(connection);

//   const tenantId = tenant._id;

//   const session = await connection.startSession();

//   try {
//     let deletedSupplier;

//     await session.withTransaction(async () => {
//       const supplier = await Supplier.findOne({
//         supplierCode: String(supplierCode).trim().toUpperCase(),

//         tenantId,

//         isDeleted: false,
//       }).session(session);

//       if (!supplier) {
//         const error = new Error("Supplier not found");

//         error.statusCode = 404;

//         throw error;
//       }

//       const oldData = supplier.toObject();

//       supplier.isDeleted = true;
//       supplier.deletedAt = new Date();
//       supplier.deletedBy = userId;
//       supplier.status = "Inactive";

//       await supplier.save({ session });

//       if (supplier.ledgerId) {
//         const ledger = await Ledger.findOneAndUpdate(
//           {
//             _id: supplier.ledgerId,
//             tenantId,
//             type: "SUPPLIER",
//             referenceType: "SUPPLIER",
//             referenceId: supplier._id,
//           },
//           {
//             $set: {
//               isActive: false,
//               updatedBy: userId,
//             },
//           },
//           {
//             new: true,
//             session,
//           },
//         );

//         if (!ledger) {
//           const error = new Error("Linked supplier ledger was not found.");

//           error.statusCode = 409;

//           throw error;
//         }
//       }

//       await AuditLog.create(
//         [
//           {
//             tenantId,
//             userId,
//             action: "DELETE",
//             module: "SUPPLIER",
//             documentId: supplier._id,
//             oldData,
//             newData: supplier.toObject(),
//             ipAddress,
//           },
//         ],
//         { session },
//       );

//       deletedSupplier = supplier;
//     });

//     return deletedSupplier;
//   } finally {
//     await session.endSession();
//   }
// };

// module.exports = {
//   createSupplier,
//   getSuppliers,
//   getSupplierByCode,
//   updateSupplier,
//   deleteSupplier,
// };

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const NotificationService = require("../../services/notificationService");

const NORMAL_BALANCE_BY_NATURE = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  INCOME: "CREDIT",
  EQUITY: "CREDIT",
};

/* ------------------------------------------------------------------ */
/* List helpers                                                        */
/* ------------------------------------------------------------------ */

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Exact enum values so compound indexes can be used
const STATUS_MAP = { active: "Active", inactive: "Inactive" };
const TYPE_MAP = { business: "Business", individual: "Individual" };
const BALANCE_TYPE_MAP = { debit: "DEBIT", credit: "CREDIT" };

const SORTABLE_FIELDS = new Set([
  "supplierCode",
  "supplierName",
  "supplierType",
  "contactPerson",
  "phone",
  "email",
  "gstNo",
  "city",
  "state",
  "paymentTerms",
  "creditLimit",
  "creditDays",
  "payableBalance",
  "status",
  "createdAt",
]);

const pick = (map, value) => map[String(value || "").trim().toLowerCase()];

const buildSupplierFilter = ({
  tenantId,
  search,
  status,
  supplierType,
  openingBalanceType,
  state,
}) => {
  const filter = { tenantId, isDeleted: false };

  const statusValue = pick(STATUS_MAP, status);
  const typeValue = pick(TYPE_MAP, supplierType);
  const balanceValue = pick(BALANCE_TYPE_MAP, openingBalanceType);

  if (statusValue) filter.status = statusValue;
  if (typeValue) filter.supplierType = typeValue;
  if (balanceValue) filter.openingBalanceType = balanceValue;

  const stateText = String(state || "").trim().slice(0, 60);
  if (stateText) {
    filter.state = new RegExp(`^${escapeRegex(stateText)}$`, "i");
  }

  const searchText = String(search || "").trim().slice(0, 100);

  if (searchText) {
    // Prefix match: much faster than "contains" and index friendly
    const prefix = new RegExp(`^${escapeRegex(searchText)}`, "i");

    filter.$or = [
      { supplierCode: prefix },
      { supplierName: prefix },
      { contactPerson: prefix },
      { phone: prefix },
      { email: prefix },
      { gstNo: prefix },
      { city: prefix },
    ];
  }

  return filter;
};

/* ------------------------------------------------------------------ */
/* Ledger helper                                                       */
/* ------------------------------------------------------------------ */

const createSupplierLedger = async ({
  models,
  tenantId,
  userId,
  supplier,
  session,
}) => {
  const { Ledger, LedgerGroup } = models;

  const sundryCreditorsGroup = await LedgerGroup.findOne({
    tenantId,
    code: "SUNDRY_CREDITORS",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!sundryCreditorsGroup) {
    const error = new Error(
      "Sundry Creditors ledger group is missing. Seed accounting groups before creating suppliers.",
    );
    error.statusCode = 400;
    throw error;
  }

  const normalBalance = NORMAL_BALANCE_BY_NATURE[sundryCreditorsGroup.nature];

  if (!normalBalance) {
    const error = new Error(
      "Sundry Creditors ledger group has an invalid account nature.",
    );
    error.statusCode = 400;
    throw error;
  }

  const ledgerCode = `SUPP-${supplier.supplierCode}`.toUpperCase();
  const openingBalance = Number(supplier.openingBalance) || 0;

  const ledgers = await Ledger.create(
    [
      {
        tenantId,
        ledgerGroupId: sundryCreditorsGroup._id,
        code: ledgerCode,
        name: supplier.supplierName,
        type: "SUPPLIER",
        nature: sundryCreditorsGroup.nature,
        normalBalance,
        openingBalance,
        openingBalanceType: supplier.openingBalanceType || normalBalance,
        currentBalance: openingBalance,
        currentBalanceType: supplier.openingBalanceType || normalBalance,
        referenceType: "SUPPLIER",
        referenceId: supplier._id,
        creditLimit: Number(supplier.creditLimit) || 0,
        creditDays: Number(supplier.creditDays) || 0,
        isSystem: false,
        isActive: supplier.status === "Active",
        description: `Supplier ledger for ${supplier.supplierName} (${supplier.supplierCode})`,
        createdBy: userId,
        updatedBy: userId,
      },
    ],
    { session },
  );

  return ledgers[0];
};

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const createSupplier = async ({ tenant, userId, payload, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);
  const models = getTenantAccountingModels(connection);
  const { Supplier, AuditLog } = models;
  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let createdSupplier;

    await session.withTransaction(async () => {
      const supplierCode = await getNextSequence(
        "SU",
        tenantId.toString(),
        3,
        { connection, session },
      );

      const supplierRecords = await Supplier.create(
        [
          {
            ...payload,
            supplierCode,
            tenantId,
            payableBalance:
              payload.openingBalanceType === "CREDIT"
                ? Number(payload.openingBalance) || 0
                : 0,
          },
        ],
        { session },
      );

      const supplier = supplierRecords[0];

      const ledger = await createSupplierLedger({
        models,
        tenantId,
        userId,
        supplier,
        session,
      });

      supplier.ledgerId = ledger._id;

      await supplier.save({ session });

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "CREATE",
            module: "SUPPLIER",
            documentId: supplier._id,
            newData: supplier.toObject(),
            ipAddress,
          },
        ],
        { session },
      );

      createdSupplier = supplier;
    });

    // A notification failure must never fail a supplier that is already saved
    try {
      await NotificationService.createForTenant({
        tenantId,
        type: "NEW_SUPPLIER",
        title: "New supplier created",
        message: `${createdSupplier.supplierName} (${createdSupplier.supplierCode}) was added successfully.`,
        icon: "truck",
        priority: "NORMAL",
        route: `/suppliers/code/${createdSupplier.supplierCode}`,
        data: {
          supplierId: createdSupplier._id.toString(),
          supplierCode: createdSupplier.supplierCode,
          ledgerId: createdSupplier.ledgerId?.toString() || null,
        },
      });
    } catch (notificationError) {
      console.error("Supplier notification failed:", notificationError);
    }

    return createdSupplier;
  } finally {
    await session.endSession();
  }
};

/* ------------------------------------------------------------------ */
/* List (server-side search / filter / sort / pagination)              */
/* ------------------------------------------------------------------ */

const getSuppliers = async ({
  tenant,
  search = "",
  status,
  supplierType,
  openingBalanceType,
  state,
  sortBy,
  sortOrder,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);
  const { Supplier } = getTenantAccountingModels(connection);

  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const pageLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const filter = buildSupplierFilter({
    tenantId: tenant._id,
    search,
    status,
    supplierType,
    openingBalanceType,
    state,
  });

  const sortField = SORTABLE_FIELDS.has(sortBy) ? sortBy : "createdAt";
  const sortDirection = sortOrder === "asc" ? 1 : -1;

  const [data, total] = await Promise.all([
    Supplier.find(filter)
      .select("-notes -deletedAt -deletedBy -__v")
      .sort({ [sortField]: sortDirection, _id: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    Supplier.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageLimit)),
    },
  };
};

/* ------------------------------------------------------------------ */
/* Stats for quick-filter chips                                        */
/* ------------------------------------------------------------------ */

const getSupplierStats = async ({ tenant }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Supplier } = getTenantAccountingModels(connection);

  const [row] = await Supplier.aggregate([
    { $match: { tenantId: tenant._id, isDeleted: false } },
    {
      $group: {
        _id: null,
        all: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] } },
        inactive: {
          $sum: { $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0] },
        },
        business: {
          $sum: { $cond: [{ $eq: ["$supplierType", "Business"] }, 1, 0] },
        },
        individual: {
          $sum: { $cond: [{ $eq: ["$supplierType", "Individual"] }, 1, 0] },
        },
      },
    },
  ]);

  return row
    ? {
        all: row.all,
        active: row.active,
        inactive: row.inactive,
        business: row.business,
        individual: row.individual,
      }
    : { all: 0, active: 0, inactive: 0, business: 0, individual: 0 };
};

/* ------------------------------------------------------------------ */
/* Read / update / delete                                              */
/* ------------------------------------------------------------------ */

const getSupplierByCode = async ({ tenant, supplierCode }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Supplier } = getTenantAccountingModels(connection);

  return Supplier.findOne({
    supplierCode: String(supplierCode).trim().toUpperCase(),
    tenantId: tenant._id,
    isDeleted: false,
  });
};

const updateSupplier = async ({
  tenant,
  userId,
  supplierCode,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);
  const { Supplier, Ledger, AuditLog } = getTenantAccountingModels(connection);
  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let updatedSupplier;

    await session.withTransaction(async () => {
      const supplier = await Supplier.findOne({
        supplierCode: String(supplierCode).trim().toUpperCase(),
        tenantId,
        isDeleted: false,
      }).session(session);

      if (!supplier) {
        const error = new Error("Supplier not found");
        error.statusCode = 404;
        throw error;
      }

      const oldData = supplier.toObject();

      /*
        openingBalance / openingBalanceType are protected: changing them here
        would not be re-posted to the ledger and the two would disagree.
      */
      const protectedFields = new Set([
        "_id",
        "tenantId",
        "supplierCode",
        "ledgerId",
        "payableBalance",
        "openingBalance",
        "openingBalanceType",
        "isDeleted",
        "deletedAt",
        "deletedBy",
        "createdAt",
        "updatedAt",
        "__v",
      ]);

      for (const [key, value] of Object.entries(payload || {})) {
        if (!protectedFields.has(key)) {
          supplier[key] = value;
        }
      }

      await supplier.save({ session });

      if (supplier.ledgerId) {
        const ledger = await Ledger.findOneAndUpdate(
          {
            _id: supplier.ledgerId,
            tenantId,
            type: "SUPPLIER",
            referenceType: "SUPPLIER",
            referenceId: supplier._id,
          },
          {
            $set: {
              name: supplier.supplierName,
              creditLimit: Number(supplier.creditLimit) || 0,
              creditDays: Number(supplier.creditDays) || 0,
              isActive: supplier.status === "Active",
              description: `Supplier ledger for ${supplier.supplierName} (${supplier.supplierCode})`,
              updatedBy: userId,
            },
          },
          { new: true, session },
        );

        if (!ledger) {
          const error = new Error("Linked supplier ledger was not found.");
          error.statusCode = 409;
          throw error;
        }
      }

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "UPDATE",
            module: "SUPPLIER",
            documentId: supplier._id,
            oldData,
            newData: supplier.toObject(),
            ipAddress,
          },
        ],
        { session },
      );

      updatedSupplier = supplier;
    });

    return updatedSupplier;
  } finally {
    await session.endSession();
  }
};

const deleteSupplier = async ({ tenant, userId, supplierCode, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);
  const { Supplier, Ledger, AuditLog } = getTenantAccountingModels(connection);
  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let deletedSupplier;

    await session.withTransaction(async () => {
      const supplier = await Supplier.findOne({
        supplierCode: String(supplierCode).trim().toUpperCase(),
        tenantId,
        isDeleted: false,
      }).session(session);

      if (!supplier) {
        const error = new Error("Supplier not found");
        error.statusCode = 404;
        throw error;
      }

      const oldData = supplier.toObject();

      supplier.isDeleted = true;
      supplier.deletedAt = new Date();
      supplier.deletedBy = userId;
      supplier.status = "Inactive";

      await supplier.save({ session });

      if (supplier.ledgerId) {
        const ledger = await Ledger.findOneAndUpdate(
          {
            _id: supplier.ledgerId,
            tenantId,
            type: "SUPPLIER",
            referenceType: "SUPPLIER",
            referenceId: supplier._id,
          },
          { $set: { isActive: false, updatedBy: userId } },
          { new: true, session },
        );

        if (!ledger) {
          const error = new Error("Linked supplier ledger was not found.");
          error.statusCode = 409;
          throw error;
        }
      }

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "DELETE",
            module: "SUPPLIER",
            documentId: supplier._id,
            oldData,
            newData: supplier.toObject(),
            ipAddress,
          },
        ],
        { session },
      );

      deletedSupplier = supplier;
    });

    return deletedSupplier;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createSupplier,
  getSuppliers,
  getSupplierStats,
  getSupplierByCode,
  updateSupplier,
  deleteSupplier,
};