const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  rupeesToPaise,
} = require("../accounting/journals/journal.service");

const {
  getNextSequence,
} = require("../../utils/sequenceGenerator");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);

  error.statusCode = statusCode;

  return error;
};

const normalizeText = (value) =>
  String(value ?? "").trim();

const normalizeCode = (value) =>
  normalizeText(value).toUpperCase();

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const maskAccount = (accountNumber) =>
  `${"X".repeat(
    Math.max(accountNumber.length - 4, 0),
  )}${accountNumber.slice(-4)}`;

const present = (
  bank,
  ledger,
  { reveal = false } = {},
) => {
  const {
    accountNumber,
    ...rest
  } = bank;

  return {
    ...rest,

    accountNumber: reveal
      ? accountNumber
      : maskAccount(accountNumber),

    ...(ledger && {
      ledgerCode: ledger.code,
      currentBalance: ledger.currentBalance,
      currentBalanceType: ledger.currentBalanceType,
    }),
  };
};

const getBankLedgerGroup = async ({
  LedgerGroup,
  tenantId,
  session,
}) => {
  const group = await LedgerGroup.findOne({
    tenantId,
    code: "BANK_ACCOUNTS",
    nature: "ASSET",
    isActive: true,
  }).session(session);

  if (!group) {
    throw createError(
      'Active ledger group "BANK_ACCOUNTS" not found. ' +
        "Run tenant accounting provisioning first.",
      409,
    );
  }

  return group;
};

const translateDuplicate = (error) =>
  error?.code === 11000
    ? createError(
        "A bank account with this name, number, or code already exists",
        409,
      )
    : error;

const createBank = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Bank,
    Ledger,
    LedgerGroup,
    AuditLog,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const group = await getBankLedgerGroup({
        LedgerGroup,
        tenantId,
        session,
      });

      const bankCode = await getNextSequence(
        "BK",
        tenantId.toString(),
        3,
        {
          connection,
          session,
        },
      );

      const bankId = new mongoose.Types.ObjectId();

      const openingBalance =
        payload.openingBalance ?? 0;

      rupeesToPaise(
        openingBalance,
        "Opening balance",
      );

      const [ledger] = await Ledger.create(
        [
          {
            tenantId,
            ledgerGroupId: group._id,
            code: bankCode,
            name: normalizeText(payload.accountName),
            type: "BANK",
            nature: "ASSET",
            normalBalance: "DEBIT",
            openingBalance,
            openingBalanceType: "DEBIT",
            currentBalance: openingBalance,
            currentBalanceType: "DEBIT",
            referenceType: "BANK",
            referenceId: bankId,
            isActive: payload.status !== "INACTIVE",
            description: `${payload.bankName} - ${payload.branchName}`,
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      const [bank] = await Bank.create(
        [
          {
            _id: bankId,
            tenantId,
            bankCode,
            accountName: payload.accountName,
            bankName: payload.bankName,
            accountHolderName:
              payload.accountHolderName,
            accountNumber: payload.accountNumber,
            accountType: payload.accountType,
            branchName: payload.branchName,
            ifscCode: payload.ifscCode,
            currency: "INR",
            status: payload.status || "ACTIVE",
            ledgerId: ledger._id,
            notes:
              normalizeText(payload.notes) || null,
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "CREATE",
            module: "BANK",
            documentId: bank._id,
            newData: {
              ...bank.toObject(),
              accountNumber: maskAccount(
                bank.accountNumber,
              ),
            },
            ipAddress,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      result = present(
        bank.toObject(),
        ledger.toObject(),
        { reveal: true },
      );
    });

    return result;
  } catch (error) {
    throw translateDuplicate(error);
  } finally {
    await session.endSession();
  }
};

const getBanks = async ({
  tenant,
  search = "",
  status,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Bank,
    Ledger,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(
    Math.floor(Number(page) || 1),
    1,
  );

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 20), 1),
    100,
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = status;
  }

  const text = normalizeText(search);

  if (text) {
    const regex = {
      $regex: escapeRegex(text),
      $options: "i",
    };

    filter.$or = [
      { bankCode: regex },
      { accountName: regex },
      { bankName: regex },
    ];
  }

  const [banks, total] = await Promise.all([
    Bank.find(filter)
      .sort({
        bankName: 1,
        accountName: 1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    Bank.countDocuments(filter),
  ]);

  const ledgers = await Ledger.find({
    tenantId,
    _id: {
      $in: banks.map((bank) => bank.ledgerId),
    },
  })
    .select(
      "code currentBalance currentBalanceType",
    )
    .lean();

  const ledgerMap = new Map(
    ledgers.map((ledger) => [
      String(ledger._id),
      ledger,
    ]),
  );

  return {
    data: banks.map((bank) =>
      present(
        bank,
        ledgerMap.get(String(bank.ledgerId)),
      ),
    ),

    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};

const getBankByCode = async ({
  tenant,
  bankCode,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Bank,
    Ledger,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const bank = await Bank.findOne({
    tenantId,
    bankCode: normalizeCode(bankCode),
    isDeleted: false,
  }).lean();

  if (!bank) {
    throw createError(
      "Bank account not found",
      404,
    );
  }

  const ledger = await Ledger.findOne({
    _id: bank.ledgerId,
    tenantId,
  })
    .select(
      "code currentBalance currentBalanceType openingBalance",
    )
    .lean();

  return present(bank, ledger, {
    reveal: true,
  });
};

const updateBank = async ({
  tenant,
  userId,
  bankCode,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Bank,
    Ledger,
    AuditLog,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const bank = await Bank.findOne({
        tenantId,
        bankCode: normalizeCode(bankCode),
        isDeleted: false,
      }).session(session);

      if (!bank) {
        throw createError(
          "Bank account not found",
          404,
        );
      }

      const ledger = await Ledger.findOne({
        _id: bank.ledgerId,
        tenantId,
        referenceType: "BANK",
        referenceId: bank._id,
      }).session(session);

      if (!ledger) {
        throw createError(
          "Linked bank ledger is missing",
          409,
        );
      }

      const oldData = {
        ...bank.toObject(),
        accountNumber: maskAccount(
          bank.accountNumber,
        ),
      };

      bank.set({
        accountName: payload.accountName,
        bankName: payload.bankName,
        accountHolderName:
          payload.accountHolderName,
        accountType: payload.accountType,
        branchName: payload.branchName,
        ifscCode: payload.ifscCode,
        status: payload.status || bank.status,
        notes:
          normalizeText(payload.notes) || null,
        updatedBy: userId,
      });

      ledger.name = bank.accountName;
      ledger.description = `${bank.bankName} - ${bank.branchName}`;
      ledger.isActive =
        bank.status === "ACTIVE";
      ledger.updatedBy = userId;

      await bank.save({ session });
      await ledger.save({ session });

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "UPDATE",
            module: "BANK",
            documentId: bank._id,
            oldData,
            newData: {
              ...bank.toObject(),
              accountNumber: maskAccount(
                bank.accountNumber,
              ),
            },
            ipAddress,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      result = present(
        bank.toObject(),
        ledger.toObject(),
        { reveal: true },
      );
    });

    return result;
  } catch (error) {
    throw translateDuplicate(error);
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createBank,
  getBanks,
  getBankByCode,
  updateBank,
};