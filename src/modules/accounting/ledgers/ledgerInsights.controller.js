const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");
const {
  getReadyTenantConnection,
} = require("../../../tenancy/tenantConnectionManager");
const { rupeesToPaise, paiseToRupees } = require("../journals/journal.service");
const { findLedger, parseDate } = require("./ledgerTransaction.controller");

const MAX_TIME_MS = 30000;
const DAY_MS = 86400000;

const createError = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

const safe = (v) => {
  if (!Number.isSafeInteger(v)) {
    throw createError("Ledger amount exceeds the supported range", 409);
  }
  return v;
};

const num = (v) => Number(v || 0);
const rupees = (paise) => paiseToRupees(safe(num(paise)));
const balanceType = (signed, normal) =>
  signed > 0 ? "DEBIT" : signed < 0 ? "CREDIT" : normal;

// Default period = current Indian financial year (1 Apr -> today, UTC)
const defaultStart = () => {
  const n = new Date();
  const y = n.getUTCMonth() >= 3 ? n.getUTCFullYear() : n.getUTCFullYear() - 1;
  return `${y}-04-01`;
};
const defaultEnd = () => new Date().toISOString().slice(0, 10);

// Adds debitPaise / creditPaise = this ledger's side of each journal
const selectedStages = (ledgerId) => [
  {
    $addFields: {
      selected: {
        $filter: {
          input: "$lines",
          as: "l",
          cond: { $eq: ["$$l.ledgerId", ledgerId] },
        },
      },
    },
  },
  {
    $addFields: {
      debitPaise: { $sum: "$selected.debitPaise" },
      creditPaise: { $sum: "$selected.creditPaise" },
    },
  },
];

const getLedgerInsights = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    if (!mongoose.isObjectIdOrHexString(tenant?._id)) {
      throw createError("Invalid tenant context");
    }

    const connection = getReadyTenantConnection(tenant);
    const models = getTenantAccountingModels(connection);
    const { Journal } = models;
    const tenantId = new mongoose.Types.ObjectId(String(tenant._id));

    const rawParam = String(req.params.ledgerCode || "").trim();
    if (!rawParam) throw createError("ledgerCode is required");

    const startDate = String(req.query.startDate || defaultStart());
    const endDate = String(req.query.endDate || defaultEnd());
    const start = parseDate(startDate, "startDate");
    const end = parseDate(endDate, "endDate");
    if (start > end) throw createError("startDate cannot be after endDate");

    const endExclusive = new Date(end.getTime() + DAY_MS);
    const days = Math.round((end - start) / DAY_MS) + 1;
    const granularity = days > 62 ? "month" : "day";
    const dateFormat = granularity === "month" ? "%Y-%m" : "%Y-%m-%d";

    const ledger = await findLedger({ models, tenantId, code: rawParam });
    const ledgerId = ledger._id;

    const openingMagnitude = rupeesToPaise(
      ledger.openingBalance || 0,
      "Ledger opening balance",
    );
    const baseSigned =
      ledger.openingBalanceType === "CREDIT"
        ? -openingMagnitude
        : openingMagnitude;

    const periodMatch = {
      $match: {
        tenantId,
        eventType: "POST",
        "lines.ledgerId": ledgerId,
        postingDate: { $gte: start, $lt: endExclusive },
      },
    };
    const opt = { allowDiskUse: true, maxTimeMS: MAX_TIME_MS };

    const rowFields = {
      $project: {
        journalNumber: 1,
        postingDate: 1,
        createdAt: 1,
        sourceType: 1,
        sourceNumber: 1,
        narration: 1,
        debitPaise: 1,
        creditPaise: 1,
        amountPaise: 1,
        counterNames: 1,
      },
    };
    const counterNamesStage = {
      $addFields: {
        amountPaise: { $add: ["$debitPaise", "$creditPaise"] },
        counterNames: {
          $map: {
            input: {
              $filter: {
                input: "$lines",
                as: "l",
                cond: { $ne: ["$$l.ledgerId", ledgerId] },
              },
            },
            as: "l",
            in: "$$l.ledgerName",
          },
        },
      },
    };

    // All aggregations are independent -> run in parallel
    const [openingAgg, coreAgg, counterAgg, largestAgg, recentAgg] =
      await Promise.all([
        // 1) movement before the period (for opening balance)
        Journal.aggregate([
          {
            $match: {
              tenantId,
              eventType: "POST",
              "lines.ledgerId": ledgerId,
              postingDate: { $lt: start },
            },
          },
          { $unwind: "$lines" },
          { $match: { "lines.ledgerId": ledgerId } },
          {
            $group: {
              _id: null,
              debitPaise: { $sum: "$lines.debitPaise" },
              creditPaise: { $sum: "$lines.creditPaise" },
            },
          },
        ]).option(opt),

        // 2) totals + voucher types + trend + weekday (tiny docs)
        Journal.aggregate([
          periodMatch,
          ...selectedStages(ledgerId),
          {
            $project: {
              postingDate: 1,
              sourceType: 1,
              debitPaise: 1,
              creditPaise: 1,
            },
          },
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    count: { $sum: 1 },
                    debitPaise: { $sum: "$debitPaise" },
                    creditPaise: { $sum: "$creditPaise" },
                    maxDebitPaise: { $max: "$debitPaise" },
                    maxCreditPaise: { $max: "$creditPaise" },
                  },
                },
              ],
              byType: [
                {
                  $group: {
                    _id: "$sourceType",
                    count: { $sum: 1 },
                    debitPaise: { $sum: "$debitPaise" },
                    creditPaise: { $sum: "$creditPaise" },
                  },
                },
                { $sort: { count: -1 } },
              ],
              trend: [
                {
                  $group: {
                    _id: {
                      $dateToString: {
                        format: dateFormat,
                        date: "$postingDate",
                        timezone: "UTC",
                      },
                    },
                    count: { $sum: 1 },
                    debitPaise: { $sum: "$debitPaise" },
                    creditPaise: { $sum: "$creditPaise" },
                  },
                },
                { $sort: { _id: 1 } },
              ],
              weekday: [
                {
                  $group: {
                    _id: {
                      $dayOfWeek: { date: "$postingDate", timezone: "UTC" },
                    },
                    count: { $sum: 1 },
                    debitPaise: { $sum: "$debitPaise" },
                    creditPaise: { $sum: "$creditPaise" },
                  },
                },
              ],
            },
          },
        ]).option(opt),

        // 3) top counter accounts
        Journal.aggregate([
          periodMatch,
          {
            $addFields: {
              counter: {
                $filter: {
                  input: "$lines",
                  as: "l",
                  cond: { $ne: ["$$l.ledgerId", ledgerId] },
                },
              },
            },
          },
          { $unwind: "$counter" },
          {
            $group: {
              _id: "$counter.ledgerId",
              code: { $first: "$counter.ledgerCode" },
              name: { $first: "$counter.ledgerName" },
              count: { $sum: 1 },
              debitPaise: { $sum: "$counter.debitPaise" },
              creditPaise: { $sum: "$counter.creditPaise" },
            },
          },
          {
            $addFields: {
              volumePaise: { $add: ["$debitPaise", "$creditPaise"] },
            },
          },
          { $sort: { volumePaise: -1 } },
          { $limit: 8 },
        ]).option(opt),

        // 4) largest transactions
        Journal.aggregate([
          periodMatch,
          ...selectedStages(ledgerId),
          counterNamesStage,
          rowFields,
          { $sort: { amountPaise: -1, _id: 1 } },
          { $limit: 5 },
        ]).option(opt),

        // 5) recent transactions
        Journal.aggregate([
          periodMatch,
          { $sort: { postingDate: -1, createdAt: -1, _id: -1 } },
          { $limit: 8 },
          ...selectedStages(ledgerId),
          counterNamesStage,
          rowFields,
        ]).option(opt),
      ]);

    // ---------- opening / closing ----------
    const openingSigned = safe(
      baseSigned +
        num(openingAgg[0]?.debitPaise) -
        num(openingAgg[0]?.creditPaise),
    );

    const facet = coreAgg[0] || {};
    const t = facet.totals?.[0] || {};
    const totalDebit = safe(num(t.debitPaise));
    const totalCredit = safe(num(t.creditPaise));
    const count = num(t.count);
    const closingSigned = safe(openingSigned + totalDebit - totalCredit);

    // ---------- trend (fill empty buckets + running closing balance) ----------
    const trendMap = new Map((facet.trend || []).map((b) => [b._id, b]));
    const trend = [];
    let running = openingSigned;

    const pushBucket = (key, label) => {
      const b = trendMap.get(key);
      const d = num(b?.debitPaise);
      const c = num(b?.creditPaise);
      running = safe(running + d - c);
      trend.push({
        key,
        label,
        count: num(b?.count),
        debit: paiseToRupees(d),
        credit: paiseToRupees(c),
        net: paiseToRupees(d - c),
        closing: paiseToRupees(running),
      });
    };

    if (granularity === "month") {
      const cur = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
      );
      const last = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
      );
      while (cur <= last) {
        const key = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`;
        const label = cur.toLocaleDateString("en-IN", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        });
        pushBucket(key, label);
        cur.setUTCMonth(cur.getUTCMonth() + 1);
      }
    } else {
      for (let i = 0; i < days; i++) {
        const d = new Date(start.getTime() + i * DAY_MS);
        pushBucket(
          d.toISOString().slice(0, 10),
          d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            timeZone: "UTC",
          }),
        );
      }
    }

    // ---------- weekday (1=Sun ... 7=Sat in Mongo) ----------
    const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const wdMap = new Map((facet.weekday || []).map((w) => [w._id, w]));
    const weekday = WD.map((day, i) => {
      const w = wdMap.get(i + 1);
      return {
        day,
        count: num(w?.count),
        debit: paiseToRupees(num(w?.debitPaise)),
        credit: paiseToRupees(num(w?.creditPaise)),
      };
    });

    const mapRow = (r) => ({
      _id: String(r._id),
      date: r.postingDate,
      journalNumber: r.journalNumber,
      sourceType: r.sourceType,
      sourceNumber: r.sourceNumber,
      narration: r.narration || "",
      counterAccount: [...new Set(r.counterNames || [])].join(", "),
      debit: rupees(r.debitPaise),
      credit: rupees(r.creditPaise),
      amount: rupees(r.amountPaise),
    });

    const debitCount = trend.reduce((s, b) => s + (b.debit > 0 ? 1 : 0), 0);

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
          isActive: ledger.isActive,
          group: ledger.ledgerGroupId || null,
        },
        period: { startDate, endDate, days, granularity, timezone: "UTC" },
        opening: {
          amount: paiseToRupees(Math.abs(openingSigned)),
          signed: paiseToRupees(openingSigned),
          type: balanceType(openingSigned, ledger.normalBalance),
        },
        closing: {
          amount: paiseToRupees(Math.abs(closingSigned)),
          signed: paiseToRupees(closingSigned),
          type: balanceType(closingSigned, ledger.normalBalance),
        },
        totals: {
          count,
          debit: paiseToRupees(totalDebit),
          credit: paiseToRupees(totalCredit),
          net: paiseToRupees(totalDebit - totalCredit),
          avgTransaction: count
            ? paiseToRupees(Math.round((totalDebit + totalCredit) / count))
            : 0,
          maxDebit: rupees(t.maxDebitPaise),
          maxCredit: rupees(t.maxCreditPaise),
          activeBuckets: trend.filter((b) => b.count > 0).length,
          debitBuckets: debitCount,
        },
        trend,
        byVoucherType: (facet.byType || []).map((b) => ({
          type: b._id,
          count: num(b.count),
          debit: paiseToRupees(num(b.debitPaise)),
          credit: paiseToRupees(num(b.creditPaise)),
        })),
        topCounterAccounts: counterAgg.map((c) => ({
          _id: String(c._id),
          code: c.code,
          name: c.name,
          count: num(c.count),
          volume: rupees(c.volumePaise),
        })),
        weekday,
        largest: largestAgg.map(mapRow),
        recent: recentAgg.map(mapRow),
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getLedgerInsights };
