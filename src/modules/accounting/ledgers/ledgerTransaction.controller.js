const mongoose = require("mongoose");

const Ledger = require("./ledger.model");
const Journal = require("../journals/journal.model");
const Bank = require("../../banks/bank.model");

const {
  rupeesToPaise,
  paiseToRupees,
} = require("../journals/journal.service");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeCode = (value) =>
  String(value || "").trim().toUpperCase();

const parseDate = (value, fieldName) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw createError(
      `${fieldName} must use YYYY-MM-DD format`,
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`${fieldName} is invalid`);
  }

  return date;
};

const parsePositiveInteger = (
  value,
  fallback,
  fieldName,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value)
  ) {
    throw createError(
      `${fieldName} must be a positive integer`,
    );
  }

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum
  ) {
    throw createError(
      `${fieldName} must be between 1 and ${maximum}`,
    );
  }

  return number;
};

const ensureSafeInteger = (value) => {
  if (!Number.isSafeInteger(value)) {
    throw createError(
      "Ledger amount exceeds the supported range",
      409,
    );
  }

  return value;
};

const getBalanceType = (signedPaise, normalBalance) => {
  if (signedPaise > 0) return "DEBIT";
  if (signedPaise < 0) return "CREDIT";

  return normalBalance;
};

const findLedger = async ({ tenantId, code }) => {
  const normalizedCode = normalizeCode(code);

  // Bank accounts use ledgerId as their explicit link.
  const bank = await Bank.findOne({
    tenantId,
    bankCode: normalizedCode,
    isDeleted: false,
  })
    .select("_id bankCode ledgerId")
    .lean();

  const filter = bank
    ? {
        tenantId,
        _id: bank.ledgerId,
      }
    : {
        tenantId,
        code: normalizedCode,
      };

  const ledger = await Ledger.findOne(filter)
    .populate("ledgerGroupId", "code name nature")
    .lean();

  if (!ledger) {
    throw createError(
      bank
        ? "The bank account's linked accounting ledger is missing"
        : "Accounting ledger not found",
      bank ? 409 : 404,
    );
  }

  // Do not exclude inactive ledgers:
  // their historical transactions must remain viewable.
  return ledger;
};

const getLedgerTransactions = async (req, res, next) => {
  try {
    if (
      !mongoose.isObjectIdOrHexString(req.tenantId)
    ) {
      throw createError("Invalid tenant context", 400);
    }

    // Explicit ObjectId for aggregation filters.
    const tenantId = new mongoose.Types.ObjectId(
      String(req.tenantId),
    );

    const code = normalizeCode(req.params.ledgerCode);

    if (!code) {
      throw createError("ledgerCode is required");
    }

    const {
      startDate,
      endDate,
    } = req.query;

    const start = parseDate(startDate, "startDate");
    const end = parseDate(endDate, "endDate");

    if (start > end) {
      throw createError(
        "startDate cannot be after endDate",
      );
    }

    // Exclusive upper bound, using UTC calendar days.
    const endExclusive = new Date(end);
    endExclusive.setUTCDate(
      endExclusive.getUTCDate() + 1,
    );

    const page = parsePositiveInteger(
      req.query.page,
      1,
      "page",
    );

    const limit = parsePositiveInteger(
      req.query.limit,
      50,
      "limit",
      200,
    );

    const offset = (page - 1) * limit;

    if (!Number.isSafeInteger(offset)) {
      throw createError("Pagination offset is too large");
    }

    const ledger = await findLedger({
      tenantId,
      code,
    });

    const openingMagnitudePaise = rupeesToPaise(
      ledger.openingBalance || 0,
      "Ledger opening balance",
    );

    const initialSignedPaise =
      ledger.openingBalanceType === "CREDIT"
        ? -openingMagnitudePaise
        : openingMagnitudePaise;

    const baseFilter = {
      tenantId,
      eventType: "POST",
      "lines.ledgerId": ledger._id,
    };

    const [openingResult] = await Journal.aggregate([
      {
        $match: {
          ...baseFilter,
          postingDate: { $lt: start },
        },
      },
      {
        $unwind: "$lines",
      },
      {
        $match: {
          "lines.ledgerId": ledger._id,
        },
      },
      {
        $group: {
          _id: null,
          debitPaise: {
            $sum: "$lines.debitPaise",
          },
          creditPaise: {
            $sum: "$lines.creditPaise",
          },
        },
      },
    ]);

    const openingSignedPaise = ensureSafeInteger(
      initialSignedPaise +
        Number(openingResult?.debitPaise || 0) -
        Number(openingResult?.creditPaise || 0),
    );

    const [periodResult] = await Journal.aggregate([
      {
        $match: {
          ...baseFilter,
          postingDate: {
            $gte: start,
            $lt: endExclusive,
          },
        },
      },
      {
        $project: {
          journalNumber: 1,
          postingDate: 1,
          createdAt: 1,
          sourceType: 1,
          sourceId: 1,
          sourceNumber: 1,
          narration: 1,

          selectedLines: {
            $filter: {
              input: "$lines",
              as: "line",
              cond: {
                $eq: [
                  "$$line.ledgerId",
                  ledger._id,
                ],
              },
            },
          },

          counterLines: {
            $filter: {
              input: "$lines",
              as: "line",
              cond: {
                $ne: [
                  "$$line.ledgerId",
                  ledger._id,
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          debitPaise: {
            $sum: "$selectedLines.debitPaise",
          },
          creditPaise: {
            $sum: "$selectedLines.creditPaise",
          },
        },
      },
      {
        $sort: {
          postingDate: 1,
          createdAt: 1,
          _id: 1,
        },
      },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                debitPaise: {
                  $sum: "$debitPaise",
                },
                creditPaise: {
                  $sum: "$creditPaise",
                },
              },
            },
          ],

          // Movement before the requested page.
          preceding: [
            { $limit: offset || 1 },
            {
              $group: {
                _id: null,
                debitPaise: {
                  $sum: "$debitPaise",
                },
                creditPaise: {
                  $sum: "$creditPaise",
                },
              },
            },
          ],

          rows: [
            { $skip: offset },
            { $limit: limit },
          ],
        },
      },
    ]);

    const totals = periodResult?.totals?.[0] || {
      total: 0,
      debitPaise: 0,
      creditPaise: 0,
    };

    const preceding =
      offset > 0
        ? periodResult?.preceding?.[0]
        : null;

    const pageOpeningSignedPaise = ensureSafeInteger(
      openingSignedPaise +
        Number(preceding?.debitPaise || 0) -
        Number(preceding?.creditPaise || 0),
    );

    let runningSignedPaise = pageOpeningSignedPaise;

    const transactions = (
      periodResult?.rows || []
    ).map((journal) => {
      const debitPaise = ensureSafeInteger(
        Number(journal.debitPaise || 0),
      );

      const creditPaise = ensureSafeInteger(
        Number(journal.creditPaise || 0),
      );

      runningSignedPaise = ensureSafeInteger(
        runningSignedPaise +
          debitPaise -
          creditPaise,
      );

      const counterNames = [
        ...new Set(
          (journal.counterLines || [])
            .map((line) => line.ledgerName)
            .filter(Boolean),
        ),
      ];

      const lineNarrations = [
        ...new Set(
          (journal.selectedLines || [])
            .map((line) => line.narration)
            .filter(Boolean),
        ),
      ];

      const counterAccount = counterNames.join(", ");

      const description =
        lineNarrations.join("; ") ||
        journal.narration ||
        counterAccount ||
        journal.sourceNumber ||
        "";

      return {
        _id: String(journal._id),
        journalId: journal._id,
        date: journal.postingDate,
        postingDate: journal.postingDate,
        journalNumber: journal.journalNumber,

        voucherType: journal.sourceType,
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        sourceNumber: journal.sourceNumber,
        reference: journal.sourceNumber,

        description,
        narration: description,
        counterAccount,
        counterLedger: counterAccount,

        debit: paiseToRupees(debitPaise),
        credit: paiseToRupees(creditPaise),

        // Positive = debit; negative = credit.
        balance: paiseToRupees(runningSignedPaise),
        balanceType: getBalanceType(
          runningSignedPaise,
          ledger.normalBalance,
        ),
      };
    });

    const totalDebitPaise = ensureSafeInteger(
      Number(totals.debitPaise || 0),
    );

    const totalCreditPaise = ensureSafeInteger(
      Number(totals.creditPaise || 0),
    );

    const closingSignedPaise = ensureSafeInteger(
      openingSignedPaise +
        totalDebitPaise -
        totalCreditPaise,
    );

    const total = Number(totals.total || 0);

    return res.status(200).json({
      success: true,

      data: {
        ledger: {
          _id: ledger._id,
          code: ledger.code,
          name: ledger.name,
          type: ledger.type,
          nature: ledger.nature,
          normalBalance: ledger.normalBalance,
          group: ledger.ledgerGroupId,
        },

        period: {
          startDate,
          endDate,
          timezone: "UTC",
        },

        openingBalance: paiseToRupees(
          openingSignedPaise,
        ),
        openingBalanceType: getBalanceType(
          openingSignedPaise,
          ledger.normalBalance,
        ),

        pageOpeningBalance: paiseToRupees(
          pageOpeningSignedPaise,
        ),

        closingBalance: paiseToRupees(
          closingSignedPaise,
        ),
        closingBalanceType: getBalanceType(
          closingSignedPaise,
          ledger.normalBalance,
        ),

        totals: {
          debit: paiseToRupees(totalDebitPaise),
          credit: paiseToRupees(totalCreditPaise),
        },
      },

      transactions,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLedgerTransactions,
};