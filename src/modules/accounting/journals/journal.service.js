// // const mongoose = require("mongoose");

// // const {
// //   getTenantAccountingModels,
// // } = require("../../../tenancy/tenantAccountingModels");

// // const { getNextSequence } = require("../../../utils/sequenceGenerator");

// // const createError = (message, statusCode = 400) => {
// //   const error = new Error(message);

// //   error.statusCode = statusCode;

// //   return error;
// // };

// // const normalizeText = (value) => String(value ?? "").trim();

// // const validateObjectId = (value, fieldName) => {
// //   if (!mongoose.isObjectIdOrHexString(value)) {
// //     throw createError(`${fieldName} must be a valid ObjectId`);
// //   }
// // };

// // const validatePaise = (value, fieldName) => {
// //   if (!Number.isSafeInteger(value) || value < 0) {
// //     throw createError(
// //       `${fieldName} must be a non-negative safe integer in paise`,
// //     );
// //   }

// //   return value;
// // };

// // const rupeesToPaise = (value, fieldName = "Amount") => {
// //   if (
// //     value === null ||
// //     value === undefined ||
// //     value === "" ||
// //     !["number", "string"].includes(typeof value)
// //   ) {
// //     throw createError(`${fieldName} must be a valid amount`);
// //   }

// //   const amount = Number(value);

// //   if (!Number.isFinite(amount) || amount < 0) {
// //     throw createError(`${fieldName} must be a non-negative amount`);
// //   }

// //   const scaled = amount * 100;
// //   const paise = Math.round(scaled);

// //   if (!Number.isSafeInteger(paise) || Math.abs(scaled - paise) > 0.000001) {
// //     throw createError(
// //       `${fieldName} must have at most two decimal places and be within range`,
// //     );
// //   }

// //   return paise;
// // };

// // const paiseToRupees = (value) => {
// //   if (!Number.isSafeInteger(value)) {
// //     throw createError("Paise amount is outside the supported range");
// //   }

// //   return value / 100;
// // };

// // const normalizeLines = (lines) => {
// //   if (!Array.isArray(lines) || lines.length < 2 || lines.length > 500) {
// //     throw createError("A journal requires between 2 and 500 lines");
// //   }

// //   return lines.map((line, index) => {
// //     if (!line || typeof line !== "object") {
// //       throw createError(`Journal line ${index + 1} is invalid`);
// //     }

// //     validateObjectId(line.ledgerId, `Line ${index + 1} ledgerId`);

// //     const debitPaise = validatePaise(
// //       line.debitPaise ?? 0,
// //       `Line ${index + 1} debitPaise`,
// //     );

// //     const creditPaise = validatePaise(
// //       line.creditPaise ?? 0,
// //       `Line ${index + 1} creditPaise`,
// //     );

// //     if (
// //       !(
// //         (debitPaise > 0 && creditPaise === 0) ||
// //         (creditPaise > 0 && debitPaise === 0)
// //       )
// //     ) {
// //       throw createError(
// //         `Line ${index + 1} must contain either a debit or a credit`,
// //       );
// //     }

// //     return {
// //       ledgerId: line.ledgerId,
// //       debitPaise,
// //       creditPaise,
// //       narration: normalizeText(line.narration) || null,
// //     };
// //   });
// // };

// // const postJournal = async ({
// //   tenant,
// //   connection,
// //   userId,
// //   postingDate,
// //   sourceType,
// //   sourceId,
// //   sourceNumber,
// //   narration = null,
// //   lines,
// //   session,
// // }) => {
// //   if (!session || !session.inTransaction()) {
// //     throw createError(
// //       "postJournal requires an active transaction session",
// //       500,
// //     );
// //   }

// //   const { Journal, Ledger } = getTenantAccountingModels(connection);

// //   const tenantId = tenant._id;

// //   validateObjectId(tenantId, "tenantId");

// //   validateObjectId(userId, "userId");
// //   validateObjectId(sourceId, "sourceId");

// //   const sourcePrefixes = {
// //     PURCHASE_BILL: "PB",
// //     SUPPLIER_PAYMENT: "SP",
// //     MANUAL_JOURNAL: "MJ",
// //     SALES_INVOICE: "SI",
// //     CUSTOMER_RECEIPT: "CR",
// //     SALES_RETURN: "SR",
// //     PURCHASE_RETURN: "PRET",
// //   };

// //   if (!Object.prototype.hasOwnProperty.call(sourcePrefixes, sourceType)) {
// //     throw createError("Unsupported journal source type");
// //   }

// //   const normalizedSourceNumber = normalizeText(sourceNumber).toUpperCase();

// //   if (!normalizedSourceNumber) {
// //     throw createError("sourceNumber is required");
// //   }

// //   if (!postingDate) {
// //     throw createError("postingDate is required");
// //   }

// //   const resolvedPostingDate = new Date(postingDate);

// //   if (Number.isNaN(resolvedPostingDate.getTime())) {
// //     throw createError("postingDate is invalid");
// //   }

// //   const normalizedLines = normalizeLines(lines);

// //   let totalDebitPaise = 0;
// //   let totalCreditPaise = 0;

// //   for (const line of normalizedLines) {
// //     totalDebitPaise += line.debitPaise;
// //     totalCreditPaise += line.creditPaise;
// //   }

// //   if (
// //     !Number.isSafeInteger(totalDebitPaise) ||
// //     !Number.isSafeInteger(totalCreditPaise)
// //   ) {
// //     throw createError("Journal totals exceed the supported range");
// //   }

// //   if (totalDebitPaise <= 0 || totalDebitPaise !== totalCreditPaise) {
// //     throw createError("Total journal debits must equal total credits");
// //   }

// //   const existingJournal = await Journal.findOne({
// //     tenantId,
// //     sourceType,
// //     sourceId,
// //     eventType: "POST",
// //   })
// //     .session(session)
// //     .select("_id journalNumber")
// //     .lean();

// //   if (existingJournal) {
// //     throw createError(
// //       `This source is already posted as ${existingJournal.journalNumber}`,
// //       409,
// //     );
// //   }

// //   const ledgerIds = [
// //     ...new Set(normalizedLines.map((line) => String(line.ledgerId))),
// //   ];

// //   const ledgers = await Ledger.find({
// //     tenantId,
// //     _id: { $in: ledgerIds },
// //     isActive: true,
// //   }).session(session);

// //   const ledgerMap = new Map(
// //     ledgers.map((ledger) => [String(ledger._id), ledger]),
// //   );

// //   const missingLedgerIds = ledgerIds.filter((id) => !ledgerMap.has(id));

// //   if (missingLedgerIds.length) {
// //     throw createError(
// //       "One or more journal ledgers are missing, inactive, or belong to another tenant",
// //       409,
// //     );
// //   }

// //   const ledgerDeltas = new Map();

// //   const journalLines = normalizedLines.map((line) => {
// //     const ledgerId = String(line.ledgerId);

// //     const ledger = ledgerMap.get(ledgerId);

// //     const delta =
// //       (ledgerDeltas.get(ledgerId) || 0) + line.debitPaise - line.creditPaise;

// //     if (!Number.isSafeInteger(delta)) {
// //       throw createError("Ledger movement exceeds the supported range");
// //     }

// //     ledgerDeltas.set(ledgerId, delta);

// //     return {
// //       ledgerId: ledger._id,
// //       ledgerCode: ledger.code,
// //       ledgerName: ledger.name,
// //       debitPaise: line.debitPaise,
// //       creditPaise: line.creditPaise,
// //       narration: line.narration,
// //     };
// //   });

// //   for (const [ledgerId, deltaPaise] of ledgerDeltas) {
// //     const ledger = ledgerMap.get(ledgerId);

// //     if (!["DEBIT", "CREDIT"].includes(ledger.currentBalanceType)) {
// //       throw createError(
// //         `Ledger ${ledger.code} has an invalid current balance type`,
// //         409,
// //       );
// //     }

// //     if (!["DEBIT", "CREDIT"].includes(ledger.normalBalance)) {
// //       throw createError(
// //         `Ledger ${ledger.code} has an invalid normal balance`,
// //         409,
// //       );
// //     }

// //     const currentMagnitudePaise = rupeesToPaise(
// //       ledger.currentBalance,
// //       `Ledger ${ledger.code} current balance`,
// //     );

// //     const currentSignedPaise =
// //       ledger.currentBalanceType === "DEBIT"
// //         ? currentMagnitudePaise
// //         : -currentMagnitudePaise;

// //     const nextSignedPaise = currentSignedPaise + deltaPaise;

// //     if (!Number.isSafeInteger(nextSignedPaise)) {
// //       throw createError("Ledger balance exceeds the supported range");
// //     }

// //     ledger.currentBalance = paiseToRupees(Math.abs(nextSignedPaise));

// //     ledger.currentBalanceType =
// //       nextSignedPaise > 0
// //         ? "DEBIT"
// //         : nextSignedPaise < 0
// //           ? "CREDIT"
// //           : ledger.normalBalance;

// //     ledger.updatedBy = userId;

// //     await ledger.save({ session });
// //   }

// //   const journalNumber = await getNextSequence("JV", tenantId.toString(), 3, {
// //     connection,
// //     session,
// //   });

// //   const records = await Journal.create(
// //     [
// //       {
// //         tenantId,
// //         journalNumber,
// //         postingDate: resolvedPostingDate,
// //         currency: "INR",
// //         sourceType,
// //         sourceId,
// //         sourceNumber: normalizedSourceNumber,
// //         eventType: "POST",
// //         lines: journalLines,
// //         totalDebitPaise,
// //         totalCreditPaise,
// //         narration: normalizeText(narration) || null,
// //         createdBy: userId,
// //       },
// //     ],
// //     {
// //       session,
// //       ordered: true,
// //     },
// //   );

// //   return records[0];
// // };

// // module.exports = {
// //   postJournal,
// //   rupeesToPaise,
// //   paiseToRupees,
// // };

// const mongoose = require("mongoose");

// const {
//   getTenantAccountingModels,
// } = require("../../../tenancy/tenantAccountingModels");

// const { getNextSequence } = require("../../../utils/sequenceGenerator");

// const createError = (message, statusCode = 400) => {
//   const error = new Error(message);

//   error.statusCode = statusCode;

//   return error;
// };

// const normalizeText = (value) => String(value ?? "").trim();

// const validateObjectId = (value, fieldName) => {
//   if (!mongoose.isObjectIdOrHexString(value)) {
//     throw createError(`${fieldName} must be a valid ObjectId`);
//   }
// };

// const validatePaise = (value, fieldName) => {
//   if (!Number.isSafeInteger(value) || value < 0) {
//     throw createError(
//       `${fieldName} must be a non-negative safe integer in paise`,
//     );
//   }

//   return value;
// };

// const rupeesToPaise = (value, fieldName = "Amount") => {
//   if (
//     value === null ||
//     value === undefined ||
//     value === "" ||
//     !["number", "string"].includes(typeof value)
//   ) {
//     throw createError(`${fieldName} must be a valid amount`);
//   }

//   const amount = Number(value);

//   if (!Number.isFinite(amount) || amount < 0) {
//     throw createError(`${fieldName} must be a non-negative amount`);
//   }

//   const scaled = amount * 100;
//   const paise = Math.round(scaled);

//   if (!Number.isSafeInteger(paise) || Math.abs(scaled - paise) > 0.000001) {
//     throw createError(
//       `${fieldName} must have at most two decimal places and be within range`,
//     );
//   }

//   return paise;
// };

// const paiseToRupees = (value) => {
//   if (!Number.isSafeInteger(value)) {
//     throw createError("Paise amount is outside the supported range");
//   }

//   return value / 100;
// };

// const normalizeLines = (lines) => {
//   if (!Array.isArray(lines) || lines.length < 2 || lines.length > 500) {
//     throw createError("A journal requires between 2 and 500 lines");
//   }

//   return lines.map((line, index) => {
//     if (!line || typeof line !== "object") {
//       throw createError(`Journal line ${index + 1} is invalid`);
//     }

//     validateObjectId(line.ledgerId, `Line ${index + 1} ledgerId`);

//     const debitPaise = validatePaise(
//       line.debitPaise ?? 0,
//       `Line ${index + 1} debitPaise`,
//     );

//     const creditPaise = validatePaise(
//       line.creditPaise ?? 0,
//       `Line ${index + 1} creditPaise`,
//     );

//     if (
//       !(
//         (debitPaise > 0 && creditPaise === 0) ||
//         (creditPaise > 0 && debitPaise === 0)
//       )
//     ) {
//       throw createError(
//         `Line ${index + 1} must contain either a debit or a credit`,
//       );
//     }

//     return {
//       ledgerId: line.ledgerId,
//       debitPaise,
//       creditPaise,
//       narration: normalizeText(line.narration) || null,
//     };
//   });
// };

// // Every journal source type must be listed here AND in the
// // sourceType enum in journal.model.js.
// const SOURCE_PREFIXES = {
//   PURCHASE_BILL: "PB",
//   SUPPLIER_PAYMENT: "SP",
//   MANUAL_JOURNAL: "MJ",
//   SALES_INVOICE: "SI",
//   CUSTOMER_RECEIPT: "CR",
//   SALES_RETURN: "SR",
//   PURCHASE_RETURN: "PRET",
//   EXPENSE: "EX",
//   CREDIT_NOTE: "CN",
//   DEBIT_NOTE: "DN",
//   TDS_DEDUCTION: "TD",
//   TDS_PAYMENT: "TP",
// };

// const postJournal = async ({
//   tenant,
//   connection,
//   userId,
//   postingDate,
//   sourceType,
//   sourceId,
//   sourceNumber,
//   narration = null,
//   lines,
//   session,
// }) => {
//   if (!session || !session.inTransaction()) {
//     throw createError(
//       "postJournal requires an active transaction session",
//       500,
//     );
//   }

//   const { Journal, Ledger } = getTenantAccountingModels(connection);

//   const tenantId = tenant._id;

//   validateObjectId(tenantId, "tenantId");

//   validateObjectId(userId, "userId");
//   validateObjectId(sourceId, "sourceId");

//   if (!Object.prototype.hasOwnProperty.call(SOURCE_PREFIXES, sourceType)) {
//     throw createError("Unsupported journal source type");
//   }

//   const normalizedSourceNumber = normalizeText(sourceNumber).toUpperCase();

//   if (!normalizedSourceNumber) {
//     throw createError("sourceNumber is required");
//   }

//   if (!postingDate) {
//     throw createError("postingDate is required");
//   }

//   const resolvedPostingDate = new Date(postingDate);

//   if (Number.isNaN(resolvedPostingDate.getTime())) {
//     throw createError("postingDate is invalid");
//   }

//   const normalizedLines = normalizeLines(lines);

//   let totalDebitPaise = 0;
//   let totalCreditPaise = 0;

//   for (const line of normalizedLines) {
//     totalDebitPaise += line.debitPaise;
//     totalCreditPaise += line.creditPaise;
//   }

//   if (
//     !Number.isSafeInteger(totalDebitPaise) ||
//     !Number.isSafeInteger(totalCreditPaise)
//   ) {
//     throw createError("Journal totals exceed the supported range");
//   }

//   if (totalDebitPaise <= 0 || totalDebitPaise !== totalCreditPaise) {
//     throw createError("Total journal debits must equal total credits");
//   }

//   const existingJournal = await Journal.findOne({
//     tenantId,
//     sourceType,
//     sourceId,
//     eventType: "POST",
//   })
//     .session(session)
//     .select("_id journalNumber")
//     .lean();

//   if (existingJournal) {
//     throw createError(
//       `This source is already posted as ${existingJournal.journalNumber}`,
//       409,
//     );
//   }

//   const ledgerIds = [
//     ...new Set(normalizedLines.map((line) => String(line.ledgerId))),
//   ];

//   const ledgers = await Ledger.find({
//     tenantId,
//     _id: { $in: ledgerIds },
//     isActive: true,
//   }).session(session);

//   const ledgerMap = new Map(
//     ledgers.map((ledger) => [String(ledger._id), ledger]),
//   );

//   const missingLedgerIds = ledgerIds.filter((id) => !ledgerMap.has(id));

//   if (missingLedgerIds.length) {
//     throw createError(
//       "One or more journal ledgers are missing, inactive, or belong to another tenant",
//       409,
//     );
//   }

//   const ledgerDeltas = new Map();

//   const journalLines = normalizedLines.map((line) => {
//     const ledgerId = String(line.ledgerId);

//     const ledger = ledgerMap.get(ledgerId);

//     const delta =
//       (ledgerDeltas.get(ledgerId) || 0) + line.debitPaise - line.creditPaise;

//     if (!Number.isSafeInteger(delta)) {
//       throw createError("Ledger movement exceeds the supported range");
//     }

//     ledgerDeltas.set(ledgerId, delta);

//     return {
//       ledgerId: ledger._id,
//       ledgerCode: ledger.code,
//       ledgerName: ledger.name,
//       debitPaise: line.debitPaise,
//       creditPaise: line.creditPaise,
//       narration: line.narration,
//     };
//   });

//   for (const [ledgerId, deltaPaise] of ledgerDeltas) {
//     const ledger = ledgerMap.get(ledgerId);

//     if (!["DEBIT", "CREDIT"].includes(ledger.currentBalanceType)) {
//       throw createError(
//         `Ledger ${ledger.code} has an invalid current balance type`,
//         409,
//       );
//     }

//     if (!["DEBIT", "CREDIT"].includes(ledger.normalBalance)) {
//       throw createError(
//         `Ledger ${ledger.code} has an invalid normal balance`,
//         409,
//       );
//     }

//     const currentMagnitudePaise = rupeesToPaise(
//       ledger.currentBalance,
//       `Ledger ${ledger.code} current balance`,
//     );

//     const currentSignedPaise =
//       ledger.currentBalanceType === "DEBIT"
//         ? currentMagnitudePaise
//         : -currentMagnitudePaise;

//     const nextSignedPaise = currentSignedPaise + deltaPaise;

//     if (!Number.isSafeInteger(nextSignedPaise)) {
//       throw createError("Ledger balance exceeds the supported range");
//     }

//     ledger.currentBalance = paiseToRupees(Math.abs(nextSignedPaise));

//     ledger.currentBalanceType =
//       nextSignedPaise > 0
//         ? "DEBIT"
//         : nextSignedPaise < 0
//           ? "CREDIT"
//           : ledger.normalBalance;

//     ledger.updatedBy = userId;

//     await ledger.save({ session });
//   }

//   const journalNumber = await getNextSequence("JV", tenantId.toString(), 3, {
//     connection,
//     session,
//   });

//   const records = await Journal.create(
//     [
//       {
//         tenantId,
//         journalNumber,
//         postingDate: resolvedPostingDate,
//         currency: "INR",
//         sourceType,
//         sourceId,
//         sourceNumber: normalizedSourceNumber,
//         eventType: "POST",
//         lines: journalLines,
//         totalDebitPaise,
//         totalCreditPaise,
//         narration: normalizeText(narration) || null,
//         createdBy: userId,
//       },
//     ],
//     {
//       session,
//       ordered: true,
//     },
//   );

//   return records[0];
// };

// module.exports = {
//   postJournal,
//   rupeesToPaise,
//   paiseToRupees,
// };
const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../../tenancy/tenantAccountingModels");

const { getNextSequence } = require("../../../utils/sequenceGenerator");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }
};

const validatePaise = (value, fieldName) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(
      `${fieldName} must be a non-negative safe integer in paise`,
    );
  }

  return value;
};

const rupeesToPaise = (value, fieldName = "Amount") => {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !["number", "string"].includes(typeof value)
  ) {
    throw createError(`${fieldName} must be a valid amount`);
  }

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw createError(`${fieldName} must be a non-negative amount`);
  }

  const scaled = amount * 100;
  const paise = Math.round(scaled);

  if (!Number.isSafeInteger(paise) || Math.abs(scaled - paise) > 0.000001) {
    throw createError(
      `${fieldName} must have at most two decimal places and be within range`,
    );
  }

  return paise;
};

const paiseToRupees = (value) => {
  if (!Number.isSafeInteger(value)) {
    throw createError("Paise amount is outside the supported range");
  }

  return value / 100;
};

const normalizeLines = (lines) => {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 500) {
    throw createError("A journal requires between 2 and 500 lines");
  }

  return lines.map((line, index) => {
    if (!line || typeof line !== "object") {
      throw createError(`Journal line ${index + 1} is invalid`);
    }

    validateObjectId(line.ledgerId, `Line ${index + 1} ledgerId`);

    const debitPaise = validatePaise(
      line.debitPaise ?? 0,
      `Line ${index + 1} debitPaise`,
    );

    const creditPaise = validatePaise(
      line.creditPaise ?? 0,
      `Line ${index + 1} creditPaise`,
    );

    if (
      !(
        (debitPaise > 0 && creditPaise === 0) ||
        (creditPaise > 0 && debitPaise === 0)
      )
    ) {
      throw createError(
        `Line ${index + 1} must contain either a debit or a credit`,
      );
    }

    return {
      ledgerId: line.ledgerId,
      debitPaise,
      creditPaise,
      narration: normalizeText(line.narration) || null,
    };
  });
};

// Every journal source type must be listed here AND in the
// sourceType enum in journal.model.js.
const SOURCE_PREFIXES = {
  PURCHASE_BILL: "PB",
  SUPPLIER_PAYMENT: "SP",
  MANUAL_JOURNAL: "MJ",
  SALES_INVOICE: "SI",
  CUSTOMER_RECEIPT: "CR",
  SALES_RETURN: "SR",
  PURCHASE_RETURN: "PRET",
  EXPENSE: "EX",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
  TDS_DEDUCTION: "TD",
  TDS_PAYMENT: "TP",
};

const postJournal = async ({
  tenant,
  connection,
  userId,
  postingDate,
  sourceType,
  sourceId,
  sourceNumber,
  narration = null,
  lines,
  session,
}) => {
  if (!session || !session.inTransaction()) {
    throw createError(
      "postJournal requires an active transaction session",
      500,
    );
  }

  const { Journal, Ledger } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  validateObjectId(tenantId, "tenantId");
  validateObjectId(userId, "userId");
  validateObjectId(sourceId, "sourceId");

  if (!Object.prototype.hasOwnProperty.call(SOURCE_PREFIXES, sourceType)) {
    throw createError("Unsupported journal source type");
  }

  const normalizedSourceNumber = normalizeText(sourceNumber).toUpperCase();

  if (!normalizedSourceNumber) {
    throw createError("sourceNumber is required");
  }

  if (!postingDate) {
    throw createError("postingDate is required");
  }

  const resolvedPostingDate = new Date(postingDate);

  if (Number.isNaN(resolvedPostingDate.getTime())) {
    throw createError("postingDate is invalid");
  }

  const normalizedLines = normalizeLines(lines);

  let totalDebitPaise = 0;
  let totalCreditPaise = 0;

  for (const line of normalizedLines) {
    totalDebitPaise += line.debitPaise;
    totalCreditPaise += line.creditPaise;
  }

  if (
    !Number.isSafeInteger(totalDebitPaise) ||
    !Number.isSafeInteger(totalCreditPaise)
  ) {
    throw createError("Journal totals exceed the supported range");
  }

  if (totalDebitPaise <= 0 || totalDebitPaise !== totalCreditPaise) {
    throw createError("Total journal debits must equal total credits");
  }

  const existingJournal = await Journal.findOne({
    tenantId,
    sourceType,
    sourceId,
    eventType: "POST",
  })
    .session(session)
    .select("_id journalNumber")
    .lean();

  if (existingJournal) {
    throw createError(
      `This source is already posted as ${existingJournal.journalNumber}`,
      409,
    );
  }

  const ledgerIds = [
    ...new Set(normalizedLines.map((line) => String(line.ledgerId))),
  ];

  const ledgers = await Ledger.find({
    tenantId,
    _id: { $in: ledgerIds },
    isActive: true,
  }).session(session);

  const ledgerMap = new Map(
    ledgers.map((ledger) => [String(ledger._id), ledger]),
  );

  const missingLedgerIds = ledgerIds.filter((id) => !ledgerMap.has(id));

  if (missingLedgerIds.length) {
    throw createError(
      "One or more journal ledgers are missing, inactive, or belong to another tenant",
      409,
    );
  }

  const ledgerDeltas = new Map();

  const journalLines = normalizedLines.map((line) => {
    const ledgerId = String(line.ledgerId);

    const ledger = ledgerMap.get(ledgerId);

    const delta =
      (ledgerDeltas.get(ledgerId) || 0) + line.debitPaise - line.creditPaise;

    if (!Number.isSafeInteger(delta)) {
      throw createError("Ledger movement exceeds the supported range");
    }

    ledgerDeltas.set(ledgerId, delta);

    return {
      ledgerId: ledger._id,
      ledgerCode: ledger.code,
      ledgerName: ledger.name,
      debitPaise: line.debitPaise,
      creditPaise: line.creditPaise,
      narration: line.narration,
    };
  });

  for (const [ledgerId, deltaPaise] of ledgerDeltas) {
    const ledger = ledgerMap.get(ledgerId);

    if (!["DEBIT", "CREDIT"].includes(ledger.currentBalanceType)) {
      throw createError(
        `Ledger ${ledger.code} has an invalid current balance type`,
        409,
      );
    }

    if (!["DEBIT", "CREDIT"].includes(ledger.normalBalance)) {
      throw createError(
        `Ledger ${ledger.code} has an invalid normal balance`,
        409,
      );
    }

    const currentMagnitudePaise = rupeesToPaise(
      ledger.currentBalance,
      `Ledger ${ledger.code} current balance`,
    );

    const currentSignedPaise =
      ledger.currentBalanceType === "DEBIT"
        ? currentMagnitudePaise
        : -currentMagnitudePaise;

    const nextSignedPaise = currentSignedPaise + deltaPaise;

    if (!Number.isSafeInteger(nextSignedPaise)) {
      throw createError("Ledger balance exceeds the supported range");
    }

    ledger.currentBalance = paiseToRupees(Math.abs(nextSignedPaise));

    ledger.currentBalanceType =
      nextSignedPaise > 0
        ? "DEBIT"
        : nextSignedPaise < 0
          ? "CREDIT"
          : ledger.normalBalance;

    ledger.updatedBy = userId;

    // FIX: only validate the fields this posting changed. Without this,
    // a ledger with a missing ledgerGroupId (for example TDS-CONTRACTOR)
    // fails with "Path `ledgerGroupId` is required" on every posting.
    await ledger.save({ session, validateModifiedOnly: true });
  }

  const journalNumber = await getNextSequence("JV", tenantId.toString(), 3, {
    connection,
    session,
  });

  const records = await Journal.create(
    [
      {
        tenantId,
        journalNumber,
        postingDate: resolvedPostingDate,
        currency: "INR",
        sourceType,
        sourceId,
        sourceNumber: normalizedSourceNumber,
        eventType: "POST",
        lines: journalLines,
        totalDebitPaise,
        totalCreditPaise,
        narration: normalizeText(narration) || null,
        createdBy: userId,
      },
    ],
    {
      session,
      ordered: true,
    },
  );

  return records[0];
};

module.exports = {
  postJournal,
  rupeesToPaise,
  paiseToRupees,
};