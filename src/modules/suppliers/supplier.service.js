const mongoose = require("mongoose");

const Supplier = require("./supplier.model");
const AuditLog = require("../../models/AuditLog");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const NotificationService = require("../../services/notificationService");

const Ledger = require("../accounting/ledgers/ledger.model");

const LedgerGroup = require("../accounting/ledger-groups/ledgerGroup.model");

const NORMAL_BALANCE_BY_NATURE = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  INCOME: "CREDIT",
  EQUITY: "CREDIT",
};

const createSupplierLedger = async ({
  tenantId,
  userId,
  supplier,
  session,
}) => {
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

const createSupplier = async ({ tenantId, userId, payload, ipAddress }) => {
  const session = await mongoose.startSession();

  try {
    let createdSupplier;

    await session.withTransaction(async () => {
      const supplierCode = await getNextSequence("SU", tenantId.toString());

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

    /*
      Keep this notification only if NEW_SUPPLIER
      exists in preferenceMap and preference schema.
    */
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
    return createdSupplier;
  } finally {
    await session.endSession();
  }
};

const getSuppliers = async ({
  tenantId,
  search = "",
  status,
  page = 1,
  limit = 20,
}) => {
  const currentPage = Math.max(Number(page) || 1, 1);

  const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = status;
  }

  const searchText = String(search || "").trim();

  if (searchText) {
    filter.$or = [
      {
        supplierName: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        supplierCode: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        phone: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        email: {
          $regex: searchText,
          $options: "i",
        },
      },
    ];
  }

  const [data, total] = await Promise.all([
    Supplier.find(filter)
      .sort({ createdAt: -1 })
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
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getSupplierByCode = async ({ tenantId, supplierCode }) => {
  return Supplier.findOne({
    supplierCode: String(supplierCode).trim().toUpperCase(),

    tenantId,

    isDeleted: false,
  });
};

const updateSupplier = async ({
  tenantId,
  userId,
  supplierCode,
  payload,
  ipAddress,
}) => {
  const session = await mongoose.startSession();

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

      const protectedFields = [
        "_id",
        "tenantId",
        "supplierCode",
        "ledgerId",
        "payableBalance",
        "isDeleted",
        "deletedAt",
        "deletedBy",
        "createdAt",
        "updatedAt",
        "__v",
      ];

      for (const [key, value] of Object.entries(payload || {})) {
        if (!protectedFields.includes(key)) {
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
          {
            new: true,
            session,
          },
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

const deleteSupplier = async ({
  tenantId,
  userId,
  supplierCode,
  ipAddress,
}) => {
  const session = await mongoose.startSession();

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
          {
            $set: {
              isActive: false,
              updatedBy: userId,
            },
          },
          {
            new: true,
            session,
          },
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
  getSupplierByCode,
  updateSupplier,
  deleteSupplier,
};
