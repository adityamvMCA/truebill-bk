// const mongoose = require("mongoose");
// const crypto = require("crypto");

// const CustomerReceipt = require("./customerReceipt.model");
// const SalesInvoice = require("../sales-invoices/salesInvoice.model");
// const Customer = require("../customers/customer.model");
// const Ledger = require("../accounting/ledgers/ledger.model");

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
//   validateObjectId(payload.customerId, "customerId");
//   validateObjectId(payload.receiptLedgerId, "receiptLedgerId");

//   const requestId = normalizeText(payload.requestId).toLowerCase();

//   if (
//     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
//       requestId,
//     )
//   ) {
//     throw createError("requestId must be a UUID v4");
//   }

//   const receiptDate = new Date(payload.receiptDate);

//   if (!payload.receiptDate || Number.isNaN(receiptDate.getTime())) {
//     throw createError("A valid receiptDate is required");
//   }

//   const receiptMethod = normalizeCode(payload.receiptMethod);

//   if (
//     !["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"].includes(receiptMethod)
//   ) {
//     throw createError("Invalid receipt method");
//   }

//   const amountPaise = assertPositivePaise(
//     rupeesToPaise(payload.amount, "Receipt amount"),
//     "Receipt amount",
//   );

//   if (!Array.isArray(payload.allocations) || !payload.allocations.length) {
//     throw createError("A receipt requires at least one allocation");
//   }

//   const seenInvoiceIds = new Set();
//   let allocatedPaise = 0;

//   const allocations = payload.allocations.map((allocation, index) => {
//     validateObjectId(
//       allocation.salesInvoiceId,
//       `Allocation ${index + 1} salesInvoiceId`,
//     );

//     const salesInvoiceId = String(allocation.salesInvoiceId).toLowerCase();

//     if (seenInvoiceIds.has(salesInvoiceId)) {
//       throw createError("An invoice can appear only once in a receipt");
//     }

//     seenInvoiceIds.add(salesInvoiceId);

//     const allocationPaise = assertPositivePaise(
//       rupeesToPaise(allocation.amount, `Allocation ${index + 1} amount`),
//       `Allocation ${index + 1} amount`,
//     );

//     allocatedPaise += allocationPaise;

//     return {
//       salesInvoiceId,
//       amountPaise: allocationPaise,
//     };
//   });

//   if (allocatedPaise !== amountPaise) {
//     throw createError("Allocated amounts must equal the receipt amount");
//   }

//   allocations.sort((first, second) =>
//     first.salesInvoiceId.localeCompare(second.salesInvoiceId),
//   );

//   const normalized = {
//     customerId: String(payload.customerId).toLowerCase(),
//     receiptLedgerId: String(payload.receiptLedgerId).toLowerCase(),
//     receiptDate: receiptDate.toISOString(),
//     receiptMethod,
//     referenceNumber: normalizeText(payload.referenceNumber) || null,
//     amountPaise,
//     allocations,
//     notes: normalizeText(payload.notes) || null,
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

// const getExistingReceipt = async ({
//   tenantId,
//   requestId,
//   requestHash,
//   session,
// }) => {
//   const query = CustomerReceipt.findOne({
//     tenantId,
//     requestId,
//   })
//     .select("+requestHash")
//     .lean();

//   if (session) {
//     query.session(session);
//   }

//   const receipt = await query;

//   if (!receipt) return null;

//   if (receipt.requestHash !== requestHash) {
//     throw createError(
//       "This requestId was already used for a different receipt",
//       409,
//     );
//   }

//   const result = { ...receipt };
//   delete result.requestHash;

//   return result;
// };

// const getCustomerAndLedger = async ({ tenantId, customerId, session }) => {
//   const customer = await Customer.findOne({
//     _id: customerId,
//     tenantId,
//     status: "Active",
//     isDeleted: false,
//   }).session(session);

//   if (!customer) {
//     throw createError("Active customer not found", 404);
//   }

//   if (!customer.ledgerId) {
//     throw createError("Customer has no linked receivable ledger", 409);
//   }

//   const ledger = await Ledger.findOne({
//     _id: customer.ledgerId,
//     tenantId,
//     type: "CUSTOMER",
//     nature: "ASSET",
//     referenceType: "CUSTOMER",
//     referenceId: customer._id,
//     isActive: true,
//   })
//     .session(session)
//     .lean();

//   if (!ledger) {
//     throw createError(
//       "The linked customer receivable ledger is missing or inactive",
//       409,
//     );
//   }

//   return { customer, ledger };
// };

// const getReceiptLedger = async ({ tenantId, request, session }) => {
//   const expectedType = request.receiptMethod === "CASH" ? "CASH" : "BANK";

//   const ledger = await Ledger.findOne({
//     _id: request.receiptLedgerId,
//     tenantId,
//     type: expectedType,
//     nature: "ASSET",
//     isActive: true,
//   })
//     .session(session)
//     .lean();

//   if (!ledger) {
//     throw createError(
//       request.receiptMethod === "CASH"
//         ? "Select an active CASH asset ledger"
//         : "Select an active BANK asset ledger",
//       409,
//     );
//   }

//   return ledger;
// };

// const notifyReceiptPosted = async ({ tenantId, userId, receipt }) => {
//   try {
//     await NotificationService.create({
//       tenantId,
//       userId,
//       type: "CUSTOMER_RECEIPT",
//       title: "Customer receipt recorded",
//       message:
//         `${receipt.receiptNumber} from ` +
//         `${receipt.customerName} was posted successfully.`,
//       icon: "receipt",
//       priority: "NORMAL",
//       route: "/sales/invoices",
//       data: {
//         customerReceiptId: String(receipt._id),
//         receiptNumber: receipt.receiptNumber,
//         customerId: String(receipt.customerId),
//         amountPaise: receipt.amountPaise,
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Customer receipt notification failed:",
//       error?.message || error,
//     );
//   }
// };

// const createCustomerReceipt = async ({
//   tenantId,
//   userId,
//   payload,
//   ipAddress,
// }) => {
//   validateObjectId(tenantId, "tenantId");
//   validateObjectId(userId, "userId");

//   const request = normalizeRequest(payload);

//   const existing = await getExistingReceipt({
//     tenantId,
//     requestId: request.requestId,
//     requestHash: request.requestHash,
//   });

//   if (existing) {
//     return {
//       receipt: existing,
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

//       const alreadyCreated = await getExistingReceipt({
//         tenantId,
//         requestId: request.requestId,
//         requestHash: request.requestHash,
//         session,
//       });

//       if (alreadyCreated) {
//         result = alreadyCreated;
//         return;
//       }

//       const { customer, ledger: customerLedger } = await getCustomerAndLedger({
//         tenantId,
//         customerId: request.customerId,
//         session,
//       });

//       const receiptLedger = await getReceiptLedger({
//         tenantId,
//         request,
//         session,
//       });

//       const customerBalancePaise = rupeesToPaise(
//         customerLedger.currentBalance,
//         "Customer ledger balance",
//       );

//       if (
//         customerLedger.currentBalanceType !== "DEBIT" ||
//         customerBalancePaise < request.amountPaise
//       ) {
//         throw createError(
//           "The customer's recorded receivable is lower than this receipt. " +
//             "Reconcile customer balances and advances before proceeding.",
//           409,
//         );
//       }

//       const invoiceIds = request.allocations.map(
//         (allocation) => allocation.salesInvoiceId,
//       );

//       const invoices = await SalesInvoice.find({
//         tenantId,
//         _id: { $in: invoiceIds },
//         customerId: customer._id,
//         customerLedgerId: customerLedger._id,
//         status: "POSTED",
//         isDeleted: false,
//       }).session(session);

//       if (invoices.length !== invoiceIds.length) {
//         throw createError(
//           "One or more selected invoices are unavailable, not posted, " +
//             "or do not belong to this customer and tenant",
//           409,
//         );
//       }

//       const invoiceMap = new Map(
//         invoices.map((invoice) => [String(invoice._id), invoice]),
//       );

//       const allocationRecords = [];

//       for (const allocation of request.allocations) {
//         const invoice = invoiceMap.get(allocation.salesInvoiceId);

//         if (
//           !Number.isSafeInteger(invoice.totalAmountPaise) ||
//           !Number.isSafeInteger(invoice.paidAmountPaise) ||
//           !Number.isSafeInteger(invoice.outstandingAmountPaise) ||
//           invoice.paidAmountPaise < 0 ||
//           invoice.outstandingAmountPaise < 0 ||
//           invoice.totalAmountPaise !==
//             invoice.paidAmountPaise + invoice.outstandingAmountPaise
//         ) {
//           throw createError(
//             `Invoice ${invoice.invoiceNumber} has inconsistent payment balances`,
//             409,
//           );
//         }

//         if (new Date(request.receiptDate) < new Date(invoice.invoiceDate)) {
//           throw createError(
//             `Receipt date cannot be before the date of ${invoice.invoiceNumber}. ` +
//               "Advance receipts are not supported in this version.",
//           );
//         }

//         if (allocation.amountPaise > invoice.outstandingAmountPaise) {
//           throw createError(
//             `Allocation exceeds the remaining amount for ${invoice.invoiceNumber}`,
//             409,
//           );
//         }

//         allocationRecords.push({
//           salesInvoiceId: invoice._id,
//           invoiceNumber: invoice.invoiceNumber,
//           amountPaise: allocation.amountPaise,
//         });
//       }

//       const receiptId = new mongoose.Types.ObjectId();

//       const receiptNumber = await getNextSequence("CR", tenantId.toString());

//       const journal = await postJournal({
//         tenantId,
//         userId,
//         postingDate: request.receiptDate,
//         sourceType: "CUSTOMER_RECEIPT",
//         sourceId: receiptId,
//         sourceNumber: receiptNumber,
//         narration:
//           `Customer receipt ${receiptNumber} — ` + customer.customerName,

//         lines: [
//           {
//             ledgerId: receiptLedger._id,
//             debitPaise: request.amountPaise,
//             creditPaise: 0,
//           },
//           {
//             ledgerId: customerLedger._id,
//             debitPaise: 0,
//             creditPaise: request.amountPaise,
//           },
//         ],

//         session,
//       });

//       for (const allocation of request.allocations) {
//         const invoice = invoiceMap.get(allocation.salesInvoiceId);

//         const oldData = invoice.toObject();

//         invoice.paidAmountPaise += allocation.amountPaise;
//         invoice.outstandingAmountPaise -= allocation.amountPaise;

//         invoice.paymentStatus =
//           invoice.outstandingAmountPaise === 0 ? "PAID" : "PARTIALLY_PAID";

//         invoice.updatedBy = userId;

//         await invoice.save({ session });

//         await AuditLog.create(
//           [
//             {
//               tenantId,
//               userId,
//               action: "UPDATE",
//               module: "SALES_INVOICE",
//               documentId: invoice._id,
//               oldData,
//               newData: invoice.toObject(),
//               ipAddress,
//             },
//           ],
//           { session, ordered: true },
//         );
//       }

//       const updatedCustomerLedger = await Ledger.findOne({
//         _id: customerLedger._id,
//         tenantId,
//       })
//         .session(session)
//         .lean();

//       if (!updatedCustomerLedger) {
//         throw createError("Customer ledger was not found after posting", 409);
//       }

//       const oldCustomerData = customer.toObject();

//       customer.receivableBalance =
//         updatedCustomerLedger.currentBalanceType === "DEBIT"
//           ? updatedCustomerLedger.currentBalance
//           : 0;

//       await customer.save({ session });

//       const postedAt = new Date();

//       const receipts = await CustomerReceipt.create(
//         [
//           {
//             _id: receiptId,
//             tenantId,
//             receiptNumber,
//             requestId: request.requestId,
//             requestHash: request.requestHash,

//             customerId: customer._id,
//             customerCode: customer.customerCode,
//             customerName: customer.customerName,
//             customerLedgerId: customerLedger._id,

//             receiptLedgerId: receiptLedger._id,
//             receiptLedgerCode: receiptLedger.code,
//             receiptLedgerName: receiptLedger.name,
//             receiptLedgerType: receiptLedger.type,

//             receiptDate: request.receiptDate,
//             receiptMethod: request.receiptMethod,
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

//       const receipt = receipts[0];

//       await AuditLog.create(
//         [
//           {
//             tenantId,
//             userId,
//             action: "CREATE",
//             module: "CUSTOMER_RECEIPT",
//             documentId: receipt._id,
//             newData: {
//               ...receipt.toObject(),
//               requestHash: undefined,
//             },
//             ipAddress,
//           },
//           {
//             tenantId,
//             userId,
//             action: "UPDATE",
//             module: "CUSTOMER",
//             documentId: customer._id,
//             oldData: oldCustomerData,
//             newData: customer.toObject(),
//             ipAddress,
//           },
//         ],
//         { session, ordered: true },
//       );

//       result = receipt.toObject();
//       delete result.requestHash;

//       createdNew = true;
//     });
//   } catch (error) {
//     if (error?.code === 11000) {
//       const replay = await getExistingReceipt({
//         tenantId,
//         requestId: request.requestId,
//         requestHash: request.requestHash,
//       });

//       if (replay) {
//         return {
//           receipt: replay,
//           replayed: true,
//         };
//       }

//       throw createError(
//         "A duplicate receipt number or request ID was detected",
//         409,
//       );
//     }

//     throw error;
//   } finally {
//     await session.endSession();
//   }

//   if (createdNew) {
//     await notifyReceiptPosted({
//       tenantId,
//       userId,
//       receipt: result,
//     });
//   }

//   return {
//     receipt: result,
//     replayed: !createdNew,
//   };
// };

// const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const getCustomerReceipts = async ({
//   tenantId,
//   search = "",
//   customerId,
//   receiptMethod,
//   fromDate,
//   toDate,
//   page = 1,
//   limit = 20,
// }) => {
//   const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

//   const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

//   const filter = { tenantId };

//   if (customerId) {
//     validateObjectId(customerId, "customerId");
//     filter.customerId = customerId;
//   }

//   if (receiptMethod) {
//     filter.receiptMethod = receiptMethod;
//   }

//   if (fromDate || toDate) {
//     filter.receiptDate = {};

//     if (fromDate) {
//       filter.receiptDate.$gte = new Date(fromDate);
//     }

//     if (toDate) {
//       filter.receiptDate.$lte = new Date(toDate);
//     }
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     const regex = {
//       $regex: escapeRegex(searchText),
//       $options: "i",
//     };

//     filter.$or = [
//       { receiptNumber: regex },
//       { customerCode: regex },
//       { customerName: regex },
//       { referenceNumber: regex },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     CustomerReceipt.find(filter)
//       .select("-allocations")
//       .sort({ receiptDate: -1, createdAt: -1 })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     CustomerReceipt.countDocuments(filter),
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

// const getCustomerReceiptByNumber = async ({ tenantId, receiptNumber }) => {
//   const receipt = await CustomerReceipt.findOne({
//     tenantId,
//     receiptNumber: normalizeCode(receiptNumber),
//   }).lean();

//   if (!receipt) {
//     throw createError("Customer receipt not found", 404);
//   }

//   return receipt;
// };

// const getUnpaidSalesInvoices = async ({
//   tenantId,
//   customerId,
//   page = 1,
//   limit = 100,
// }) => {
//   validateObjectId(customerId, "customerId");

//   const customer = await Customer.findOne({
//     _id: customerId,
//     tenantId,
//     isDeleted: false,
//     status: "Active",
//   })
//     .select("_id")
//     .lean();

//   if (!customer) {
//     throw createError("Active customer not found", 404);
//   }

//   const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

//   const pageLimit = Math.min(
//     Math.max(Math.floor(Number(limit) || 100), 1),
//     100,
//   );

//   const filter = {
//     tenantId,
//     customerId,
//     status: "POSTED",
//     isDeleted: false,
//     outstandingAmountPaise: { $gt: 0 },
//   };

//   const [data, total] = await Promise.all([
//     SalesInvoice.find(filter)
//       .select(
//         "invoiceNumber invoiceDate dueDate totalAmountPaise paidAmountPaise outstandingAmountPaise paymentStatus",
//       )
//       .sort({ dueDate: 1, createdAt: 1 })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     SalesInvoice.countDocuments(filter),
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

// const getReceiptLedgers = async ({ tenantId }) =>
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
//   createCustomerReceipt,
//   getCustomerReceipts,
//   getCustomerReceiptByNumber,
//   getUnpaidSalesInvoices,
//   getReceiptLedgers,
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
  validateObjectId(payload.customerId, "customerId");
  validateObjectId(payload.receiptLedgerId, "receiptLedgerId");

  const requestId = normalizeText(payload.requestId).toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      requestId,
    )
  ) {
    throw createError("requestId must be a UUID v4");
  }

  const receiptDate = new Date(payload.receiptDate);

  if (!payload.receiptDate || Number.isNaN(receiptDate.getTime())) {
    throw createError("A valid receiptDate is required");
  }

  const receiptMethod = normalizeCode(payload.receiptMethod);

  if (
    !["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"].includes(
      receiptMethod,
    )
  ) {
    throw createError("Invalid receipt method");
  }

  const amountPaise = assertPositivePaise(
    rupeesToPaise(payload.amount, "Receipt amount"),
    "Receipt amount",
  );

  if (!Array.isArray(payload.allocations) || !payload.allocations.length) {
    throw createError("A receipt requires at least one allocation");
  }

  const seenInvoiceIds = new Set();
  let allocatedPaise = 0;

  const allocations = payload.allocations.map((allocation, index) => {
    validateObjectId(
      allocation.salesInvoiceId,
      `Allocation ${index + 1} salesInvoiceId`,
    );

    const salesInvoiceId = String(
      allocation.salesInvoiceId,
    ).toLowerCase();

    if (seenInvoiceIds.has(salesInvoiceId)) {
      throw createError("An invoice can appear only once in a receipt");
    }

    seenInvoiceIds.add(salesInvoiceId);

    const allocationPaise = assertPositivePaise(
      rupeesToPaise(
        allocation.amount,
        `Allocation ${index + 1} amount`,
      ),
      `Allocation ${index + 1} amount`,
    );

    allocatedPaise += allocationPaise;

    return {
      salesInvoiceId,
      amountPaise: allocationPaise,
    };
  });

  if (allocatedPaise !== amountPaise) {
    throw createError("Allocated amounts must equal the receipt amount");
  }

  allocations.sort((first, second) =>
    first.salesInvoiceId.localeCompare(second.salesInvoiceId),
  );

  const normalized = {
    customerId: String(payload.customerId).toLowerCase(),
    receiptLedgerId: String(payload.receiptLedgerId).toLowerCase(),
    receiptDate: receiptDate.toISOString(),
    receiptMethod,
    referenceNumber: normalizeText(payload.referenceNumber) || null,
    amountPaise,
    allocations,
    notes: normalizeText(payload.notes) || null,
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

const getExistingReceipt = async ({
  models,
  tenantId,
  requestId,
  requestHash,
  session,
}) => {
  const { CustomerReceipt } = models;

  const query = CustomerReceipt.findOne({
    tenantId,
    requestId,
  })
    .select("+requestHash")
    .lean();

  if (session) {
    query.session(session);
  }

  const receipt = await query;

  if (!receipt) return null;

  if (receipt.requestHash !== requestHash) {
    throw createError(
      "This requestId was already used for a different receipt",
      409,
    );
  }

  const result = { ...receipt };

  delete result.requestHash;

  return result;
};

const getCustomerAndLedger = async ({
  models,
  tenantId,
  customerId,
  session,
}) => {
  const { Customer, Ledger } = models;

  const customer = await Customer.findOne({
    _id: customerId,
    tenantId,
    status: "Active",
    isDeleted: false,
  }).session(session);

  if (!customer) {
    throw createError("Active customer not found", 404);
  }

  if (!customer.ledgerId) {
    throw createError("Customer has no linked receivable ledger", 409);
  }

  const ledger = await Ledger.findOne({
    _id: customer.ledgerId,
    tenantId,
    type: "CUSTOMER",
    nature: "ASSET",
    referenceType: "CUSTOMER",
    referenceId: customer._id,
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(
      "The linked customer receivable ledger is missing or inactive",
      409,
    );
  }

  return { customer, ledger };
};

const getReceiptLedger = async ({
  models,
  tenantId,
  request,
  session,
}) => {
  const { Ledger } = models;

  const expectedType = request.receiptMethod === "CASH"
    ? "CASH"
    : "BANK";

  const ledger = await Ledger.findOne({
    _id: request.receiptLedgerId,
    tenantId,
    type: expectedType,
    nature: "ASSET",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(
      request.receiptMethod === "CASH"
        ? "Select an active CASH asset ledger"
        : "Select an active BANK asset ledger",
      409,
    );
  }

  return ledger;
};

const notifyReceiptPosted = async ({
  tenantId,
  userId,
  receipt,
}) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,
      type: "CUSTOMER_RECEIPT",
      title: "Customer receipt recorded",
      message:
        `${receipt.receiptNumber} from ` +
        `${receipt.customerName} was posted successfully.`,
      icon: "receipt",
      priority: "NORMAL",
      route: "/sales/invoices",
      data: {
        customerReceiptId: String(receipt._id),
        receiptNumber: receipt.receiptNumber,
        customerId: String(receipt.customerId),
        amountPaise: receipt.amountPaise,
      },
    });
  } catch (error) {
    console.error(
      "Customer receipt notification failed:",
      error?.message || error,
    );
  }
};

const createCustomerReceipt = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const {
    CustomerReceipt,
    SalesInvoice,
    Ledger,
    AuditLog,
  } = models;

  const tenantId = tenant._id;

  validateObjectId(tenantId, "tenantId");
  validateObjectId(userId, "userId");

  const request = normalizeRequest(payload);

  const existing = await getExistingReceipt({
    models,
    tenantId,
    requestId: request.requestId,
    requestHash: request.requestHash,
  });

  if (existing) {
    return {
      receipt: existing,
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

      const alreadyCreated = await getExistingReceipt({
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
        customer,
        ledger: customerLedger,
      } = await getCustomerAndLedger({
        models,
        tenantId,
        customerId: request.customerId,
        session,
      });

      const receiptLedger = await getReceiptLedger({
        models,
        tenantId,
        request,
        session,
      });

      const customerBalancePaise = rupeesToPaise(
        customerLedger.currentBalance,
        "Customer ledger balance",
      );

      if (
        customerLedger.currentBalanceType !== "DEBIT" ||
        customerBalancePaise < request.amountPaise
      ) {
        throw createError(
          "The customer's recorded receivable is lower than this receipt. " +
            "Reconcile customer balances and advances before proceeding.",
          409,
        );
      }

      const invoiceIds = request.allocations.map(
        (allocation) => allocation.salesInvoiceId,
      );

      const invoices = await SalesInvoice.find({
        tenantId,
        _id: { $in: invoiceIds },
        customerId: customer._id,
        customerLedgerId: customerLedger._id,
        status: "POSTED",
        isDeleted: false,
      }).session(session);

      if (invoices.length !== invoiceIds.length) {
        throw createError(
          "One or more selected invoices are unavailable, not posted, " +
            "or do not belong to this customer and tenant",
          409,
        );
      }

      const invoiceMap = new Map(
        invoices.map((invoice) => [String(invoice._id), invoice]),
      );

      const allocationRecords = [];

      for (const allocation of request.allocations) {
        const invoice = invoiceMap.get(allocation.salesInvoiceId);

        if (
          !Number.isSafeInteger(invoice.totalAmountPaise) ||
          !Number.isSafeInteger(invoice.paidAmountPaise) ||
          !Number.isSafeInteger(invoice.outstandingAmountPaise) ||
          invoice.paidAmountPaise < 0 ||
          invoice.outstandingAmountPaise < 0 ||
          invoice.totalAmountPaise !==
            invoice.paidAmountPaise + invoice.outstandingAmountPaise
        ) {
          throw createError(
            `Invoice ${invoice.invoiceNumber} has inconsistent payment balances`,
            409,
          );
        }

        if (
          new Date(request.receiptDate) <
          new Date(invoice.invoiceDate)
        ) {
          throw createError(
            `Receipt date cannot be before the date of ${invoice.invoiceNumber}. ` +
              "Advance receipts are not supported in this version.",
          );
        }

        if (allocation.amountPaise > invoice.outstandingAmountPaise) {
          throw createError(
            `Allocation exceeds the remaining amount for ${invoice.invoiceNumber}`,
            409,
          );
        }

        allocationRecords.push({
          salesInvoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          amountPaise: allocation.amountPaise,
        });
      }

      const receiptId = new mongoose.Types.ObjectId();

      const receiptNumber = await getNextSequence(
        "CR",
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
        postingDate: request.receiptDate,
        sourceType: "CUSTOMER_RECEIPT",
        sourceId: receiptId,
        sourceNumber: receiptNumber,
        narration:
          `Customer receipt ${receiptNumber} — ` +
          customer.customerName,

        lines: [
          {
            ledgerId: receiptLedger._id,
            debitPaise: request.amountPaise,
            creditPaise: 0,
          },
          {
            ledgerId: customerLedger._id,
            debitPaise: 0,
            creditPaise: request.amountPaise,
          },
        ],

        session,
      });

      for (const allocation of request.allocations) {
        const invoice = invoiceMap.get(allocation.salesInvoiceId);

        const oldData = invoice.toObject();

        invoice.paidAmountPaise += allocation.amountPaise;
        invoice.outstandingAmountPaise -= allocation.amountPaise;

        invoice.paymentStatus =
          invoice.outstandingAmountPaise === 0
            ? "PAID"
            : "PARTIALLY_PAID";

        invoice.updatedBy = userId;

        await invoice.save({ session });

        await AuditLog.create(
          [
            {
              tenantId,
              userId,
              action: "UPDATE",
              module: "SALES_INVOICE",
              documentId: invoice._id,
              oldData,
              newData: invoice.toObject(),
              ipAddress,
            },
          ],
          { session, ordered: true },
        );
      }

      const updatedCustomerLedger = await Ledger.findOne({
        _id: customerLedger._id,
        tenantId,
      })
        .session(session)
        .lean();

      if (!updatedCustomerLedger) {
        throw createError(
          "Customer ledger was not found after posting",
          409,
        );
      }

      const oldCustomerData = customer.toObject();

      customer.receivableBalance =
        updatedCustomerLedger.currentBalanceType === "DEBIT"
          ? updatedCustomerLedger.currentBalance
          : 0;

      await customer.save({ session });

      const postedAt = new Date();

      const receipts = await CustomerReceipt.create(
        [
          {
            _id: receiptId,
            tenantId,
            receiptNumber,
            requestId: request.requestId,
            requestHash: request.requestHash,

            customerId: customer._id,
            customerCode: customer.customerCode,
            customerName: customer.customerName,
            customerLedgerId: customerLedger._id,

            receiptLedgerId: receiptLedger._id,
            receiptLedgerCode: receiptLedger.code,
            receiptLedgerName: receiptLedger.name,
            receiptLedgerType: receiptLedger.type,

            receiptDate: request.receiptDate,
            receiptMethod: request.receiptMethod,
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

      const receipt = receipts[0];

      await AuditLog.create(
        [
          {
            tenantId,
            userId,
            action: "CREATE",
            module: "CUSTOMER_RECEIPT",
            documentId: receipt._id,
            newData: {
              ...receipt.toObject(),
              requestHash: undefined,
            },
            ipAddress,
          },
          {
            tenantId,
            userId,
            action: "UPDATE",
            module: "CUSTOMER",
            documentId: customer._id,
            oldData: oldCustomerData,
            newData: customer.toObject(),
            ipAddress,
          },
        ],
        { session, ordered: true },
      );

      result = receipt.toObject();
      delete result.requestHash;

      createdNew = true;
    });
  } catch (error) {
    if (error?.code === 11000) {
      const replay = await getExistingReceipt({
        models,
        tenantId,
        requestId: request.requestId,
        requestHash: request.requestHash,
      });

      if (replay) {
        return {
          receipt: replay,
          replayed: true,
        };
      }

      throw createError(
        "A duplicate receipt number or request ID was detected",
        409,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }

  if (createdNew) {
    await notifyReceiptPosted({
      tenantId,
      userId,
      receipt: result,
    });
  }

  return {
    receipt: result,
    replayed: !createdNew,
  };
};

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getCustomerReceipts = async ({
  tenant,
  search = "",
  customerId,
  receiptMethod,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { CustomerReceipt } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 20), 1),
    100,
  );

  const filter = { tenantId };

  if (customerId) {
    validateObjectId(customerId, "customerId");
    filter.customerId = customerId;
  }

  if (receiptMethod) {
    filter.receiptMethod = receiptMethod;
  }

  if (fromDate || toDate) {
    filter.receiptDate = {};

    if (fromDate) {
      filter.receiptDate.$gte = new Date(fromDate);
    }

    if (toDate) {
      filter.receiptDate.$lte = new Date(toDate);
    }
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    filter.$or = [
      { receiptNumber: regex },
      { customerCode: regex },
      { customerName: regex },
      { referenceNumber: regex },
    ];
  }

  const [data, total] = await Promise.all([
    CustomerReceipt.find(filter)
      .select("-allocations")
      .sort({ receiptDate: -1, createdAt: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    CustomerReceipt.countDocuments(filter),
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

const getCustomerReceiptByNumber = async ({
  tenant,
  receiptNumber,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { CustomerReceipt } = getTenantAccountingModels(connection);

  const receipt = await CustomerReceipt.findOne({
    tenantId: tenant._id,
    receiptNumber: normalizeCode(receiptNumber),
  }).lean();

  if (!receipt) {
    throw createError("Customer receipt not found", 404);
  }

  return receipt;
};

const getUnpaidSalesInvoices = async ({
  tenant,
  customerId,
  page = 1,
  limit = 100,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const {
    Customer,
    SalesInvoice,
  } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  validateObjectId(customerId, "customerId");

  const customer = await Customer.findOne({
    _id: customerId,
    tenantId,
    isDeleted: false,
    status: "Active",
  })
    .select("_id")
    .lean();

  if (!customer) {
    throw createError("Active customer not found", 404);
  }

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 100), 1),
    100,
  );

  const filter = {
    tenantId,
    customerId,
    status: "POSTED",
    isDeleted: false,
    outstandingAmountPaise: { $gt: 0 },
  };

  const [data, total] = await Promise.all([
    SalesInvoice.find(filter)
      .select(
        "invoiceNumber invoiceDate dueDate totalAmountPaise paidAmountPaise outstandingAmountPaise paymentStatus",
      )
      .sort({ dueDate: 1, createdAt: 1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    SalesInvoice.countDocuments(filter),
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

const getReceiptLedgers = async ({ tenant }) => {
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
  createCustomerReceipt,
  getCustomerReceipts,
  getCustomerReceiptByNumber,
  getUnpaidSalesInvoices,
  getReceiptLedgers,
};