// const mongoose = require("mongoose");
// const crypto = require("crypto");

// const SupplierPayment = require("./supplierPayment.model");

// const PurchaseBill = require("../purchase-bills/purchaseBill.model");

// const Supplier = require("../suppliers/supplier.model");

// const Ledger = require("../accounting/ledgers/ledger.model");
// const Journal = require("../accounting/journals/journal.model");
// const {
//   postJournal,
//   rupeesToPaise,
// } = require("../accounting/journals/journal.service");

// const AuditLog = require("../../models/AuditLog");

// const NotificationService = require("../../services/notificationService");

// const { getNextSequence } = require("../../utils/sequenceGenerator");

// const createError = (message, statusCode = 400) => {
//   const error = new Error(message);
//   error.statusCode = statusCode;
//   return error;
// };

// const normalizeText = (value) => String(value ?? "").trim();

// const normalizeCode = (value) => normalizeText(value).toUpperCase();

// const validateObjectId = (value, fieldName) => {
//   if (!mongoose.isObjectIdOrHexString(value)) {
//     throw createError(`${fieldName} must be a valid ObjectId`);
//   }
// };

// const assertPositivePaise = (amount, fieldName) => {
//   if (!Number.isSafeInteger(amount) || amount <= 0) {
//     throw createError(
//       `${fieldName} must be a positive amount within the supported range`,
//     );
//   }

//   return amount;
// };

// const normalizeRequest = (payload) => {
//   validateObjectId(payload.supplierId, "supplierId");
//   validateObjectId(payload.paymentLedgerId, "paymentLedgerId");

//   const requestId = normalizeText(payload.requestId).toLowerCase();

//   if (
//     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
//       requestId,
//     )
//   ) {
//     throw createError("requestId must be a UUID v4");
//   }

//   const paymentDate = new Date(payload.paymentDate);

//   if (!payload.paymentDate || Number.isNaN(paymentDate.getTime())) {
//     throw createError("A valid paymentDate is required");
//   }

//   const paymentMethod = normalizeCode(payload.paymentMethod);

//   if (
//     !["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"].includes(paymentMethod)
//   ) {
//     throw createError("Invalid payment method");
//   }

//   const amountPaise = assertPositivePaise(
//     rupeesToPaise(payload.amount, "Payment amount"),
//     "Payment amount",
//   );

//   if (amountPaise > 100000000000) {
//     throw createError("Payment amount exceeds the supported limit");
//   }

//   if (
//     !Array.isArray(payload.allocations) ||
//     payload.allocations.length < 1 ||
//     payload.allocations.length > 200
//   ) {
//     throw createError("A payment requires between 1 and 200 allocations");
//   }

//   const seenBillIds = new Set();
//   let allocatedPaise = 0;

//   const allocations = payload.allocations.map((allocation, index) => {
//     validateObjectId(
//       allocation.purchaseBillId,
//       `Allocation ${index + 1} purchaseBillId`,
//     );

//     const purchaseBillId = String(allocation.purchaseBillId).toLowerCase();

//     if (seenBillIds.has(purchaseBillId)) {
//       throw createError("A bill can appear only once in a payment");
//     }

//     seenBillIds.add(purchaseBillId);

//     const allocationPaise = assertPositivePaise(
//       rupeesToPaise(allocation.amount, `Allocation ${index + 1} amount`),
//       `Allocation ${index + 1} amount`,
//     );

//     allocatedPaise += allocationPaise;

//     if (!Number.isSafeInteger(allocatedPaise)) {
//       throw createError("Allocated total exceeds the supported range");
//     }

//     return {
//       purchaseBillId,
//       amountPaise: allocationPaise,
//     };
//   });

//   if (allocatedPaise !== amountPaise) {
//     throw createError("Allocated amounts must equal the payment amount");
//   }

//   allocations.sort((first, second) =>
//     first.purchaseBillId.localeCompare(second.purchaseBillId),
//   );

//   const referenceNumber = normalizeText(payload.referenceNumber) || null;

//   const notes = normalizeText(payload.notes) || null;

//   if (referenceNumber && referenceNumber.length > 100) {
//     throw createError("Reference number cannot exceed 100 characters");
//   }

//   if (notes && notes.length > 1000) {
//     throw createError("Notes cannot exceed 1000 characters");
//   }

//   const normalized = {
//     supplierId: String(payload.supplierId).toLowerCase(),
//     paymentLedgerId: String(payload.paymentLedgerId).toLowerCase(),
//     paymentDate: paymentDate.toISOString(),
//     paymentMethod,
//     referenceNumber,
//     amountPaise,
//     allocations,
//     notes,
//   };

//   const requestHash = crypto
//     .createHash("sha256")
//     .update(JSON.stringify(normalized))
//     .digest("hex");

//   return {
//     ...normalized,
//     requestId,
//     requestHash,
//   };
// };

// const checkExistingPayment = (payment, requestHash) => {
//   if (payment.requestHash !== requestHash) {
//     throw createError(
//       "This requestId was already used for a different payment",
//       409,
//     );
//   }

//   const result = { ...payment };
//   delete result.requestHash;

//   return result;
// };

// const getExistingPayment = async ({
//   tenantId,
//   requestId,
//   requestHash,
//   session,
// }) => {
//   const query = SupplierPayment.findOne({
//     tenantId,
//     requestId,
//   })
//     .select("+requestHash")
//     .lean();

//   if (session) {
//     query.session(session);
//   }

//   const payment = await query;

//   return payment ? checkExistingPayment(payment, requestHash) : null;
// };

// const getSupplierAndLedger = async ({ tenantId, supplierId, session }) => {
//   const supplier = await Supplier.findOne({
//     _id: supplierId,
//     tenantId,
//     status: "Active",
//     isDeleted: false,
//   }).session(session);

//   if (!supplier) {
//     throw createError("Active supplier not found", 404);
//   }

//   if (!supplier.ledgerId) {
//     throw createError("Supplier has no linked accounting ledger", 409);
//   }

//   const ledger = await Ledger.findOne({
//     _id: supplier.ledgerId,
//     tenantId,
//     type: "SUPPLIER",
//     nature: "LIABILITY",
//     referenceType: "SUPPLIER",
//     referenceId: supplier._id,
//     isActive: true,
//   }).session(session);

//   if (!ledger) {
//     throw createError("The linked supplier ledger is missing or inactive", 409);
//   }

//   return { supplier, ledger };
// };

// const getPaymentLedger = async ({ tenantId, request, session }) => {
//   const expectedType = request.paymentMethod === "CASH" ? "CASH" : "BANK";

//   const ledger = await Ledger.findOne({
//     _id: request.paymentLedgerId,
//     tenantId,
//     type: expectedType,
//     nature: "ASSET",
//     isActive: true,
//   }).session(session);

//   if (!ledger) {
//     throw createError(
//       request.paymentMethod === "CASH"
//         ? "Select an active CASH asset ledger"
//         : "Select an active BANK asset ledger",
//       409,
//     );
//   }

//   const balancePaise = rupeesToPaise(
//     ledger.currentBalance,
//     `Balance of ${ledger.name}`,
//   );

//   if (
//     ledger.currentBalanceType !== "DEBIT" ||
//     balancePaise < request.amountPaise
//   ) {
//     throw createError(
//       `Insufficient recorded balance in ${ledger.name}. ` +
//         "This version does not support negative cash or bank balances.",
//       409,
//     );
//   }

//   return ledger;
// };

// const notifyPaymentPosted = async ({ tenantId, userId, payment }) => {
//   try {
//     await NotificationService.create({
//       tenantId,
//       userId,
//       type: "SUPPLIER_PAYMENT",
//       title: "Supplier payment recorded",
//       message:
//         `${payment.paymentNumber} for ` +
//         `${payment.supplierName} was posted successfully.`,
//       icon: "payment",
//       priority: "NORMAL",
//       route: "/purchase/invoices",
//       data: {
//         supplierPaymentId: String(payment._id),
//         paymentNumber: payment.paymentNumber,
//         supplierId: String(payment.supplierId),
//         amountPaise: payment.amountPaise,
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Supplier payment notification failed:",
//       error?.message || error,
//     );
//   }
// };

// const createSupplierPayment = async ({
//   tenantId,
//   userId,
//   payload,
//   ipAddress,
// }) => {
//   validateObjectId(tenantId, "tenantId");
//   validateObjectId(userId, "userId");

//   const request = normalizeRequest(payload);

//   const existing = await getExistingPayment({
//     tenantId,
//     requestId: request.requestId,
//     requestHash: request.requestHash,
//   });

//   if (existing) {
//     return {
//       payment: existing,
//       replayed: true,
//     };
//   }

//   const session = await mongoose.startSession();

//   let result;
//   let createdNew = false;

//   try {
//     await session.withTransaction(async () => {
//       createdNew = false;
//       result = null;

//       const alreadyCreated = await getExistingPayment({
//         tenantId,
//         requestId: request.requestId,
//         requestHash: request.requestHash,
//         session,
//       });

//       if (alreadyCreated) {
//         result = alreadyCreated;
//         return;
//       }

//       const { supplier, ledger: supplierLedger } = await getSupplierAndLedger({
//         tenantId,
//         supplierId: request.supplierId,
//         session,
//       });

//       const paymentLedger = await getPaymentLedger({
//         tenantId,
//         request,
//         session,
//       });

//       const supplierBalancePaise = rupeesToPaise(
//         supplierLedger.currentBalance,
//         "Supplier ledger balance",
//       );

//       if (
//         supplierLedger.currentBalanceType !== "CREDIT" ||
//         supplierBalancePaise < request.amountPaise
//       ) {
//         throw createError(
//           "The supplier's recorded payable is lower than this payment. " +
//             "Reconcile supplier balances and advances before proceeding.",
//           409,
//         );
//       }

//       const billIds = request.allocations.map(
//         (allocation) => allocation.purchaseBillId,
//       );

//       const bills = await PurchaseBill.find({
//         tenantId,
//         _id: { $in: billIds },
//         supplierId: supplier._id,
//         supplierLedgerId: supplierLedger._id,
//         status: "POSTED",
//         isDeleted: false,
//       }).session(session);

//       if (bills.length !== billIds.length) {
//         throw createError(
//           "One or more selected bills are unavailable, not posted, " +
//             "or do not belong to this supplier and tenant",
//           409,
//         );
//       }

//       const billMap = new Map(bills.map((bill) => [String(bill._id), bill]));

//       const allocationRecords = [];

//       for (const allocation of request.allocations) {
//         const bill = billMap.get(allocation.purchaseBillId);

//         if (
//           !Number.isSafeInteger(bill.totalAmountPaise) ||
//           !Number.isSafeInteger(bill.paidAmountPaise) ||
//           !Number.isSafeInteger(bill.outstandingAmountPaise) ||
//           bill.paidAmountPaise < 0 ||
//           bill.outstandingAmountPaise < 0 ||
//           bill.totalAmountPaise !==
//             bill.paidAmountPaise + bill.outstandingAmountPaise
//         ) {
//           throw createError(
//             `Bill ${bill.billNumber} has inconsistent payment balances`,
//             409,
//           );
//         }

//         if (new Date(request.paymentDate) < new Date(bill.billDate)) {
//           throw createError(
//             `Payment date cannot be before the date of ${bill.billNumber}. ` +
//               "Advance payments are not supported in this version.",
//           );
//         }

//         if (allocation.amountPaise > bill.outstandingAmountPaise) {
//           throw createError(
//             `Allocation exceeds the remaining amount for ${bill.billNumber}`,
//             409,
//           );
//         }

//         allocationRecords.push({
//           purchaseBillId: bill._id,
//           billNumber: bill.billNumber,
//           supplierInvoiceNumber: bill.supplierInvoiceNumber,
//           amountPaise: allocation.amountPaise,
//         });
//       }

//       const paymentId = new mongoose.Types.ObjectId();

//       const paymentNumber = await getNextSequence("SP", tenantId.toString());

//       const journal = await postJournal({
//         tenantId,
//         userId,
//         postingDate: request.paymentDate,
//         sourceType: "SUPPLIER_PAYMENT",
//         sourceId: paymentId,
//         sourceNumber: paymentNumber,
//         narration:
//           `Supplier payment ${paymentNumber} — ` + supplier.supplierName,

//         lines: [
//           {
//             ledgerId: supplierLedger._id,
//             debitPaise: request.amountPaise,
//             creditPaise: 0,
//           },
//           {
//             ledgerId: paymentLedger._id,
//             debitPaise: 0,
//             creditPaise: request.amountPaise,
//           },
//         ],

//         session,
//       });

//       for (const allocation of request.allocations) {
//         const bill = billMap.get(allocation.purchaseBillId);

//         const oldData = bill.toObject();

//         bill.paidAmountPaise += allocation.amountPaise;

//         bill.outstandingAmountPaise -= allocation.amountPaise;

//         bill.paymentStatus =
//           bill.outstandingAmountPaise === 0 ? "PAID" : "PARTIALLY_PAID";

//         bill.updatedBy = userId;

//         await bill.save({ session });

//         await AuditLog.create(
//           [
//             {
//               tenantId,
//               userId,
//               action: "UPDATE",
//               module: "PURCHASE_BILL",
//               documentId: bill._id,
//               oldData,
//               newData: bill.toObject(),
//               ipAddress,
//             },
//           ],
//           { session, ordered: true },
//         );
//       }

//       const updatedSupplierLedger = await Ledger.findOne({
//         _id: supplierLedger._id,
//         tenantId,
//       })
//         .session(session)
//         .lean();

//       if (!updatedSupplierLedger) {
//         throw createError("Supplier ledger was not found after posting", 409);
//       }

//       const oldSupplierData = supplier.toObject();

//       supplier.payableBalance =
//         updatedSupplierLedger.currentBalanceType === "CREDIT"
//           ? updatedSupplierLedger.currentBalance
//           : 0;

//       await supplier.save({ session });

//       const postedAt = new Date();

//       const payments = await SupplierPayment.create(
//         [
//           {
//             _id: paymentId,
//             tenantId,
//             paymentNumber,
//             requestId: request.requestId,
//             requestHash: request.requestHash,

//             supplierId: supplier._id,
//             supplierCode: supplier.supplierCode,
//             supplierName: supplier.supplierName,
//             supplierLedgerId: supplierLedger._id,

//             paymentLedgerId: paymentLedger._id,
//             paymentLedgerCode: paymentLedger.code,
//             paymentLedgerName: paymentLedger.name,
//             paymentLedgerType: paymentLedger.type,

//             paymentDate: request.paymentDate,
//             paymentMethod: request.paymentMethod,
//             referenceNumber: request.referenceNumber,

//             currency: "INR",
//             amountPaise: request.amountPaise,
//             allocations: allocationRecords,

//             status: "POSTED",
//             journalId: journal._id,
//             postedAt,
//             postedBy: userId,

//             notes: request.notes,
//             createdBy: userId,
//             updatedBy: userId,
//           },
//         ],
//         { session, ordered: true },
//       );

//       const payment = payments[0];

//       await AuditLog.create(
//         [
//           {
//             tenantId,
//             userId,
//             action: "CREATE",
//             module: "SUPPLIER_PAYMENT",
//             documentId: payment._id,
//             newData: {
//               ...payment.toObject(),
//               requestHash: undefined,
//             },
//             ipAddress,
//           },
//           {
//             tenantId,
//             userId,
//             action: "UPDATE",
//             module: "SUPPLIER",
//             documentId: supplier._id,
//             oldData: oldSupplierData,
//             newData: supplier.toObject(),
//             ipAddress,
//           },
//         ],
//         { session, ordered: true },
//       );

//       result = payment.toObject();
//       delete result.requestHash;

//       createdNew = true;
//     });
//   } catch (error) {
//     if (error?.code === 11000) {
//       const replay = await getExistingPayment({
//         tenantId,
//         requestId: request.requestId,
//         requestHash: request.requestHash,
//       });

//       if (replay) {
//         return {
//           payment: replay,
//           replayed: true,
//         };
//       }

//       throw createError(
//         "A duplicate payment number or request ID was detected",
//         409,
//       );
//     }

//     throw error;
//   } finally {
//     await session.endSession();
//   }

//   if (createdNew) {
//     await notifyPaymentPosted({
//       tenantId,
//       userId,
//       payment: result,
//     });
//   }

//   return {
//     payment: result,
//     replayed: !createdNew,
//   };
// };

// const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const getSupplierPayments = async ({
//   tenantId,
//   search = "",
//   supplierId,
//   paymentMethod,
//   fromDate,
//   toDate,
//   page = 1,
//   limit = 20,
// }) => {
//   const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

//   const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

//   const filter = { tenantId };

//   if (supplierId) {
//     validateObjectId(supplierId, "supplierId");
//     filter.supplierId = supplierId;
//   }

//   if (paymentMethod) {
//     filter.paymentMethod = paymentMethod;
//   }

//   if (fromDate || toDate) {
//     filter.paymentDate = {};

//     if (fromDate) {
//       filter.paymentDate.$gte = new Date(fromDate);
//     }

//     if (toDate) {
//       if (/^\d{4}-\d{2}-\d{2}$/.test(String(toDate))) {
//         const nextDay = new Date(`${toDate}T00:00:00Z`);

//         nextDay.setUTCDate(nextDay.getUTCDate() + 1);

//         filter.paymentDate.$lt = nextDay;
//       } else {
//         filter.paymentDate.$lte = new Date(toDate);
//       }
//     }
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     const regex = {
//       $regex: escapeRegex(searchText),
//       $options: "i",
//     };

//     filter.$or = [
//       { paymentNumber: regex },
//       { supplierCode: regex },
//       { supplierName: regex },
//       { referenceNumber: regex },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     SupplierPayment.find(filter)
//       .select("-allocations")
//       .sort({
//         paymentDate: -1,
//         createdAt: -1,
//       })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     SupplierPayment.countDocuments(filter),
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

// // const getSupplierPaymentByNumber = async ({ tenantId, paymentNumber }) => {
// //   const payment = await SupplierPayment.findOne({
// //     tenantId,
// //     paymentNumber: normalizeCode(paymentNumber),
// //   }).lean();

// //   if (!payment) {
// //     throw createError("Supplier payment not found", 404);
// //   }

// //   return payment;
// // };

// const getSupplierPaymentByNumber = async ({ tenantId, paymentNumber }) => {
//   const payment = await SupplierPayment.findOne({
//     tenantId,
//     paymentNumber: normalizeCode(paymentNumber),
//   }).lean();

//   if (!payment) {
//     throw createError("Supplier payment not found", 404);
//   }

//   const journal = payment.journalId
//     ? await Journal.findOne({
//         _id: payment.journalId,
//         tenantId,
//       })
//         .select("journalNumber")
//         .lean()
//     : null;

//   return {
//     ...payment,
//     journalNumber: journal?.journalNumber || null,
//   };
// };
// const getUnpaidSupplierBills = async ({
//   tenantId,
//   supplierId,
//   page = 1,
//   limit = 100,
// }) => {
//   validateObjectId(supplierId, "supplierId");

//   const supplier = await Supplier.findOne({
//     _id: supplierId,
//     tenantId,
//     isDeleted: false,
//     status: "Active",
//   })
//     .select("_id")
//     .lean();

//   if (!supplier) {
//     throw createError("Active supplier not found", 404);
//   }

//   const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

//   const pageLimit = Math.min(
//     Math.max(Math.floor(Number(limit) || 100), 1),
//     100,
//   );

//   const filter = {
//     tenantId,
//     supplierId,
//     status: "POSTED",
//     isDeleted: false,
//     outstandingAmountPaise: { $gt: 0 },
//   };

//   const [data, total] = await Promise.all([
//     PurchaseBill.find(filter)
//       .select(
//         "billNumber supplierInvoiceNumber billDate dueDate " +
//           "totalAmountPaise paidAmountPaise " +
//           "outstandingAmountPaise paymentStatus",
//       )
//       .sort({
//         dueDate: 1,
//         createdAt: 1,
//       })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     PurchaseBill.countDocuments(filter),
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

// const getPaymentLedgers = async ({ tenantId }) =>
//   Ledger.find({
//     tenantId,
//     type: { $in: ["CASH", "BANK"] },
//     nature: "ASSET",
//     isActive: true,
//   })
//     .select("code name type currentBalance currentBalanceType")
//     .sort({ type: 1, name: 1 })
//     .lean();

// module.exports = {
//   createSupplierPayment,
//   getSupplierPayments,
//   getSupplierPaymentByNumber,
//   getUnpaidSupplierBills,
//   getPaymentLedgers,
// };


const mongoose = require("mongoose");
const crypto = require("crypto");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  postJournal,
  rupeesToPaise,
} = require("../accounting/journals/journal.service");

const NotificationService = require("../../services/notificationService");

const { getNextSequence } = require("../../utils/sequenceGenerator");

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeText = (value) => String(value ?? "").trim();

const normalizeCode = (value) => normalizeText(value).toUpperCase();

const validateObjectId = (value, fieldName) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw createError(`${fieldName} must be a valid ObjectId`);
  }
};

const assertPositivePaise = (amount, fieldName) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw createError(
      `${fieldName} must be a positive amount within the supported range`,
    );
  }

  return amount;
};

const normalizeRequest = (payload) => {
  validateObjectId(payload.supplierId, "supplierId");
  validateObjectId(payload.paymentLedgerId, "paymentLedgerId");

  const requestId = normalizeText(payload.requestId).toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      requestId,
    )
  ) {
    throw createError("requestId must be a UUID v4");
  }

  const paymentDate = new Date(payload.paymentDate);

  if (!payload.paymentDate || Number.isNaN(paymentDate.getTime())) {
    throw createError("A valid paymentDate is required");
  }

  const paymentMethod = normalizeCode(payload.paymentMethod);

  if (
    !["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"].includes(
      paymentMethod,
    )
  ) {
    throw createError("Invalid payment method");
  }

  const amountPaise = assertPositivePaise(
    rupeesToPaise(payload.amount, "Payment amount"),
    "Payment amount",
  );

  if (amountPaise > 100000000000) {
    throw createError("Payment amount exceeds the supported limit");
  }

  if (
    !Array.isArray(payload.allocations) ||
    payload.allocations.length < 1 ||
    payload.allocations.length > 200
  ) {
    throw createError("A payment requires between 1 and 200 allocations");
  }

  const seenBillIds = new Set();
  let allocatedPaise = 0;

  const allocations = payload.allocations.map((allocation, index) => {
    validateObjectId(
      allocation.purchaseBillId,
      `Allocation ${index + 1} purchaseBillId`,
    );

    const purchaseBillId = String(
      allocation.purchaseBillId,
    ).toLowerCase();

    if (seenBillIds.has(purchaseBillId)) {
      throw createError("A bill can appear only once in a payment");
    }

    seenBillIds.add(purchaseBillId);

    const allocationPaise = assertPositivePaise(
      rupeesToPaise(
        allocation.amount,
        `Allocation ${index + 1} amount`,
      ),
      `Allocation ${index + 1} amount`,
    );

    allocatedPaise += allocationPaise;

    if (!Number.isSafeInteger(allocatedPaise)) {
      throw createError("Allocated total exceeds the supported range");
    }

    return {
      purchaseBillId,
      amountPaise: allocationPaise,
    };
  });

  if (allocatedPaise !== amountPaise) {
    throw createError("Allocated amounts must equal the payment amount");
  }

  allocations.sort((first, second) =>
    first.purchaseBillId.localeCompare(second.purchaseBillId),
  );

  const referenceNumber = normalizeText(payload.referenceNumber) || null;

  const notes = normalizeText(payload.notes) || null;

  if (referenceNumber && referenceNumber.length > 100) {
    throw createError("Reference number cannot exceed 100 characters");
  }

  if (notes && notes.length > 1000) {
    throw createError("Notes cannot exceed 1000 characters");
  }

  const normalized = {
    supplierId: String(payload.supplierId).toLowerCase(),
    paymentLedgerId: String(payload.paymentLedgerId).toLowerCase(),
    paymentDate: paymentDate.toISOString(),
    paymentMethod,
    referenceNumber,
    amountPaise,
    allocations,
    notes,
  };

  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");

  return {
    ...normalized,
    requestId,
    requestHash,
  };
};

const checkExistingPayment = (payment, requestHash) => {
  if (payment.requestHash !== requestHash) {
    throw createError(
      "This requestId was already used for a different payment",
      409,
    );
  }

  const result = { ...payment };

  delete result.requestHash;

  return result;
};

const getExistingPayment = async ({
  models,
  tenantId,
  requestId,
  requestHash,
  session,
}) => {
  const { SupplierPayment } = models;

  const query = SupplierPayment.findOne({
    tenantId,
    requestId,
  })
    .select("+requestHash")
    .lean();

  if (session) {
    query.session(session);
  }

  const payment = await query;

  return payment
    ? checkExistingPayment(payment, requestHash)
    : null;
};

const getSupplierAndLedger = async ({
  models,
  tenantId,
  supplierId,
  session,
}) => {
  const { Supplier, Ledger } = models;

  const supplier = await Supplier.findOne({
    _id: supplierId,
    tenantId,
    status: "Active",
    isDeleted: false,
  }).session(session);

  if (!supplier) {
    throw createError("Active supplier not found", 404);
  }

  if (!supplier.ledgerId) {
    throw createError("Supplier has no linked accounting ledger", 409);
  }

  const ledger = await Ledger.findOne({
    _id: supplier.ledgerId,
    tenantId,
    type: "SUPPLIER",
    nature: "LIABILITY",
    referenceType: "SUPPLIER",
    referenceId: supplier._id,
    isActive: true,
  }).session(session);

  if (!ledger) {
    throw createError(
      "The linked supplier ledger is missing or inactive",
      409,
    );
  }

  return { supplier, ledger };
};

const getPaymentLedger = async ({
  models,
  tenantId,
  request,
  session,
}) => {
  const { Ledger } = models;

  const expectedType = request.paymentMethod === "CASH"
    ? "CASH"
    : "BANK";

  const ledger = await Ledger.findOne({
    _id: request.paymentLedgerId,
    tenantId,
    type: expectedType,
    nature: "ASSET",
    isActive: true,
  }).session(session);

  if (!ledger) {
    throw createError(
      request.paymentMethod === "CASH"
        ? "Select an active CASH asset ledger"
        : "Select an active BANK asset ledger",
      409,
    );
  }

  const balancePaise = rupeesToPaise(
    ledger.currentBalance,
    `Balance of ${ledger.name}`,
  );

  if (
    ledger.currentBalanceType !== "DEBIT" ||
    balancePaise < request.amountPaise
  ) {
    throw createError(
      `Insufficient recorded balance in ${ledger.name}. ` +
        "This version does not support negative cash or bank balances.",
      409,
    );
  }

  return ledger;
};

const notifyPaymentPosted = async ({
  tenantId,
  userId,
  payment,
}) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,
      type: "SUPPLIER_PAYMENT",
      title: "Supplier payment recorded",
      message:
        `${payment.paymentNumber} for ` +
        `${payment.supplierName} was posted successfully.`,
      icon: "payment",
      priority: "NORMAL",
      route: "/purchase/invoices",
      data: {
        supplierPaymentId: String(payment._id),
        paymentNumber: payment.paymentNumber,
        supplierId: String(payment.supplierId),
        amountPaise: payment.amountPaise,
      },
    });
  } catch (error) {
    console.error(
      "Supplier payment notification failed:",
      error?.message || error,
    );
  }
};

const createSupplierPayment = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const {
    SupplierPayment,
    PurchaseBill,
    Ledger,
    AuditLog,
  } = models;

  const tenantId = tenant._id;

  validateObjectId(tenantId, "tenantId");
  validateObjectId(userId, "userId");

  const request = normalizeRequest(payload);

  const existing = await getExistingPayment({
    models,
    tenantId,
    requestId: request.requestId,
    requestHash: request.requestHash,
  });

  if (existing) {
    return {
      payment: existing,
      replayed: true,
    };
  }

  const session = await connection.startSession();

  let result;
  let createdNew = false;

  try {
    await session.withTransaction(async () => {
      createdNew = false;
      result = null;

      const alreadyCreated = await getExistingPayment({
        models,
        tenantId,
        requestId: request.requestId,
        requestHash: request.requestHash,
        session,
      });

      if (alreadyCreated) {
        result = alreadyCreated;
        return;
      }

      const {
        supplier,
        ledger: supplierLedger,
      } = await getSupplierAndLedger({
        models,
        tenantId,
        supplierId: request.supplierId,
        session,
      });

      const paymentLedger = await getPaymentLedger({
        models,
        tenantId,
        request,
        session,
      });

      const supplierBalancePaise = rupeesToPaise(
        supplierLedger.currentBalance,
        "Supplier ledger balance",
      );

      if (
        supplierLedger.currentBalanceType !== "CREDIT" ||
        supplierBalancePaise < request.amountPaise
      ) {
        throw createError(
          "The supplier's recorded payable is lower than this payment. " +
            "Reconcile supplier balances and advances before proceeding.",
          409,
        );
      }

      const billIds = request.allocations.map(
        (allocation) => allocation.purchaseBillId,
      );

      const bills = await PurchaseBill.find({
        tenantId,
        _id: { $in: billIds },
        supplierId: supplier._id,
        supplierLedgerId: supplierLedger._id,
        status: "POSTED",
        isDeleted: false,
      }).session(session);

      if (bills.length !== billIds.length) {
        throw createError(
          "One or more selected bills are unavailable, not posted, " +
            "or do not belong to this supplier and tenant",
          409,
        );
      }

      const billMap = new Map(
        bills.map((bill) => [String(bill._id), bill]),
      );

      const allocationRecords = [];

      for (const allocation of request.allocations) {
        const bill = billMap.get(allocation.purchaseBillId);

        if (
          !Number.isSafeInteger(bill.totalAmountPaise) ||
          !Number.isSafeInteger(bill.paidAmountPaise) ||
          !Number.isSafeInteger(bill.outstandingAmountPaise) ||
          bill.paidAmountPaise < 0 ||
          bill.outstandingAmountPaise < 0 ||
          bill.totalAmountPaise !==
            bill.paidAmountPaise + bill.outstandingAmountPaise
        ) {
          throw createError(
            `Bill ${bill.billNumber} has inconsistent payment balances`,
            409,
          );
        }

        if (new Date(request.paymentDate) < new Date(bill.billDate)) {
          throw createError(
            `Payment date cannot be before the date of ${bill.billNumber}. ` +
              "Advance payments are not supported in this version.",
          );
        }

        if (allocation.amountPaise > bill.outstandingAmountPaise) {
          throw createError(
            `Allocation exceeds the remaining amount for ${bill.billNumber}`,
            409,
          );
        }

        allocationRecords.push({
          purchaseBillId: bill._id,
          billNumber: bill.billNumber,
          supplierInvoiceNumber: bill.supplierInvoiceNumber,
          amountPaise: allocation.amountPaise,
        });
      }

      const paymentId = new mongoose.Types.ObjectId();

      const paymentNumber = await getNextSequence(
        "SP",
        tenantId.toString(),
        3,
        {
          connection,
          session,
        },
      );

      const journal = await postJournal({
        tenant,
        connection,
        userId,
        postingDate: request.paymentDate,
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: paymentId,
        sourceNumber: paymentNumber,
        narration:
          `Supplier payment ${paymentNumber} — ` +
          supplier.supplierName,

        lines: [
          {
            ledgerId: supplierLedger._id,
            debitPaise: request.amountPaise,
            creditPaise: 0,
          },
          {
            ledgerId: paymentLedger._id,
            debitPaise: 0,
            creditPaise: request.amountPaise,
          },
        ],

        session,
      });

      for (const allocation of request.allocations) {
        const bill = billMap.get(allocation.purchaseBillId);

        const oldData = bill.toObject();

        bill.paidAmountPaise += allocation.amountPaise;

        bill.outstandingAmountPaise -= allocation.amountPaise;

        bill.paymentStatus =
          bill.outstandingAmountPaise === 0
            ? "PAID"
            : "PARTIALLY_PAID";

        bill.updatedBy = userId;

        await bill.save({ session });

        await AuditLog.create(
          [
            {
              tenantId,
              userId,
              action: "UPDATE",
              module: "PURCHASE_BILL",
              documentId: bill._id,
              oldData,
              newData: bill.toObject(),
              ipAddress,
            },
          ],
          { session, ordered: true },
        );
      }

      const updatedSupplierLedger = await Ledger.findOne({
        _id: supplierLedger._id,
        tenantId,
      })
        .session(session)
        .lean();

      if (!updatedSupplierLedger) {
        throw createError(
          "Supplier ledger was not found after posting",
          409,
        );
      }

      const oldSupplierData = supplier.toObject();

      supplier.payableBalance =
        updatedSupplierLedger.currentBalanceType === "CREDIT"
          ? updatedSupplierLedger.currentBalance
          : 0;

      await supplier.save({ session });

      const postedAt = new Date();

      const payments = await SupplierPayment.create(
        [
          {
            _id: paymentId,
            tenantId,
            paymentNumber,
            requestId: request.requestId,
            requestHash: request.requestHash,

            supplierId: supplier._id,
            supplierCode: supplier.supplierCode,
            supplierName: supplier.supplierName,
            supplierLedgerId: supplierLedger._id,

            paymentLedgerId: paymentLedger._id,
            paymentLedgerCode: paymentLedger.code,
            paymentLedgerName: paymentLedger.name,
            paymentLedgerType: paymentLedger.type,

            paymentDate: request.paymentDate,
            paymentMethod: request.paymentMethod,
            referenceNumber: request.referenceNumber,

            currency: "INR",
            amountPaise: request.amountPaise,
            allocations: allocationRecords,

            status: "POSTED",
            journalId: journal._id,
            postedAt,
            postedBy: userId,

            notes: request.notes,
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );

      const payment = payments[0];

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "CREATE",
            module: "SUPPLIER_PAYMENT",
            documentId: payment._id,
            newData: {
              ...payment.toObject(),
              requestHash: undefined,
            },
            ipAddress,
          },
          {
            tenantId,
            userId,
            action: "UPDATE",
            module: "SUPPLIER",
            documentId: supplier._id,
            oldData: oldSupplierData,
            newData: supplier.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );

      result = payment.toObject();

      delete result.requestHash;

      createdNew = true;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await getExistingPayment({
        models,
        tenantId,
        requestId: request.requestId,
        requestHash: request.requestHash,
      });

      if (replay) {
        return {
          payment: replay,
          replayed: true,
        };
      }

      throw createError(
        "A duplicate payment number or request ID was detected",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }

  if (createdNew) {
    await notifyPaymentPosted({
      tenantId,
      userId,
      payment: result,
    });
  }

  return {
    payment: result,
    replayed: !createdNew,
  };
};

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSupplierPayments = async ({
  tenant,
  search = "",
  supplierId,
  paymentMethod,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { SupplierPayment } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 20), 1),
    100,
  );

  const filter = { tenantId };

  if (supplierId) {
    validateObjectId(supplierId, "supplierId");
    filter.supplierId = supplierId;
  }

  if (paymentMethod) {
    filter.paymentMethod = paymentMethod;
  }

  if (fromDate || toDate) {
    filter.paymentDate = {};

    if (fromDate) {
      filter.paymentDate.$gte = new Date(fromDate);
    }

    if (toDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(toDate))) {
        const nextDay = new Date(`${toDate}T00:00:00Z`);

        nextDay.setUTCDate(nextDay.getUTCDate() + 1);

        filter.paymentDate.$lt = nextDay;
      } else {
        filter.paymentDate.$lte = new Date(toDate);
      }
    }
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    filter.$or = [
      { paymentNumber: regex },
      { supplierCode: regex },
      { supplierName: regex },
      { referenceNumber: regex },
    ];
  }

  const [data, total] = await Promise.all([
    SupplierPayment.find(filter)
      .select("-allocations")
      .sort({
        paymentDate: -1,
        createdAt: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    SupplierPayment.countDocuments(filter),
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

// const getSupplierPaymentByNumber = async ({ tenantId, paymentNumber }) => {
//   const payment = await SupplierPayment.findOne({
//     tenantId,
//     paymentNumber: normalizeCode(paymentNumber),
//   }).lean();

//   if (!payment) {
//     throw createError("Supplier payment not found", 404);
//   }

//   return payment;
// };

const getSupplierPaymentByNumber = async ({
  tenant,
  paymentNumber,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    SupplierPayment,
    Journal,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const payment = await SupplierPayment.findOne({
    tenantId,
    paymentNumber: normalizeCode(paymentNumber),
  }).lean();

  if (!payment) {
    throw createError("Supplier payment not found", 404);
  }

  const journal = payment.journalId
    ? await Journal.findOne({
        _id: payment.journalId,
        tenantId,
      })
        .select("journalNumber")
        .lean()
    : null;

  return {
    ...payment,
    journalNumber: journal?.journalNumber || null,
  };
};

const getUnpaidSupplierBills = async ({
  tenant,
  supplierId,
  page = 1,
  limit = 100,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Supplier,
    PurchaseBill,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  validateObjectId(supplierId, "supplierId");

  const supplier = await Supplier.findOne({
    _id: supplierId,
    tenantId,
    isDeleted: false,
    status: "Active",
  })
    .select("_id")
    .lean();

  if (!supplier) {
    throw createError("Active supplier not found", 404);
  }

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 100), 1),
    100,
  );

  const filter = {
    tenantId,
    supplierId,
    status: "POSTED",
    isDeleted: false,
    outstandingAmountPaise: { $gt: 0 },
  };

  const [data, total] = await Promise.all([
    PurchaseBill.find(filter)
      .select(
        "billNumber supplierInvoiceNumber billDate dueDate " +
          "totalAmountPaise paidAmountPaise " +
          "outstandingAmountPaise paymentStatus",
      )
      .sort({
        dueDate: 1,
        createdAt: 1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    PurchaseBill.countDocuments(filter),
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

const getPaymentLedgers = async ({ tenant }) => {
  const connection = getReadyTenantConnection(tenant);

  const { Ledger } = getTenantAccountingModels(connection);

  return Ledger.find({
    tenantId: tenant._id,
    type: { $in: ["CASH", "BANK"] },
    nature: "ASSET",
    isActive: true,
  })
    .select("code name type currentBalance currentBalanceType")
    .sort({ type: 1, name: 1 })
    .lean();
};

module.exports = {
  createSupplierPayment,
  getSupplierPayments,
  getSupplierPaymentByNumber,
  getUnpaidSupplierBills,
  getPaymentLedgers,
};