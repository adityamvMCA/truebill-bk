// const mongoose = require("mongoose");

// const SalesInvoice = require("./salesInvoice.model");
// const Customer = require("../customers/customer.model");
// const Product = require("../products/product.model");
// const Ledger = require("../accounting/ledgers/ledger.model");

// const {
//   postJournal,
//   rupeesToPaise,
//   paiseToRupees,
// } = require("../accounting/journals/journal.service");

// const stockMovementService = require("../stock-movements/stockMovement.service");

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

// const assertSafeAmount = (value, fieldName = "Amount") => {
//   if (!Number.isSafeInteger(value) || value < 0) {
//     throw createError(`${fieldName} exceeds the supported range`);
//   }

//   return value;
// };

// const addAmounts = (first, second) => assertSafeAmount(first + second);

// const multiplyDivide = (first, second, divisor) => {
//   assertSafeAmount(first);
//   assertSafeAmount(second);

//   if (!Number.isSafeInteger(divisor) || divisor <= 0) {
//     throw createError("Invalid calculation divisor");
//   }

//   const numerator = BigInt(first) * BigInt(second);
//   const denominator = BigInt(divisor);
//   const rounded = (numerator + denominator / 2n) / denominator;

//   return assertSafeAmount(Number(rounded));
// };

// const scaledNumber = ({ value, scale, minimum, maximum, fieldName }) => {
//   if (typeof value !== "number" || !Number.isFinite(value)) {
//     throw createError(`${fieldName} must be a valid number`);
//   }

//   if (value < minimum || value > maximum) {
//     throw createError(`${fieldName} must be between ${minimum} and ${maximum}`);
//   }

//   const scaled = value * scale;
//   const integer = Math.round(scaled);

//   if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
//     throw createError(`${fieldName} has too many decimal places`);
//   }

//   return integer;
// };

// const getCustomer = async ({ tenantId, customerId, session }) => {
//   validateObjectId(customerId, "customerId");

//   const customer = await Customer.findOne({
//     _id: customerId,
//     tenantId,
//     isDeleted: false,
//     status: "Active",
//   }).session(session);

//   if (!customer) {
//     throw createError("Active customer not found", 404);
//   }

//   if (!customer.ledgerId) {
//     throw createError("Customer does not have a linked receivable ledger", 409);
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

//   return customer;
// };

// const getSalesLedger = async ({ tenantId, ledgerId, session }) => {
//   const filter = {
//     tenantId,
//     isActive: true,
//     nature: "INCOME",
//     type: { $in: ["ACCOUNT", "SYSTEM"] },
//   };

//   if (ledgerId) {
//     filter._id = ledgerId;
//   } else {
//     filter.code = "SALES";
//   }

//   const ledger = await Ledger.findOne(filter).session(session).lean();

//   if (!ledger) {
//     throw createError(
//       ledgerId
//         ? "The product sales ledger is missing, inactive, or not an income ledger"
//         : "The active SALES income ledger is missing. Seed accounting ledgers first.",
//       409,
//     );
//   }

//   return ledger;
// };

// const getOutputTaxLedger = async ({ tenantId, code, session }) => {
//   const ledger = await Ledger.findOne({
//     tenantId,
//     code,
//     type: "TAX",
//     nature: "LIABILITY",
//     isActive: true,
//   })
//     .session(session)
//     .lean();

//   if (!ledger) {
//     throw createError(
//       `Active ${code} output tax ledger is missing. Seed accounting ledgers first.`,
//       409,
//     );
//   }

//   return ledger;
// };

// const calculateInvoice = async ({ tenantId, payload, session }) => {
//   const customer = await getCustomer({
//     tenantId,
//     customerId: payload.customerId,
//     session,
//   });

//   const invoiceDate = new Date(payload.invoiceDate);
//   const dueDate = new Date(payload.dueDate);

//   if (
//     !payload.invoiceDate ||
//     !payload.dueDate ||
//     Number.isNaN(invoiceDate.getTime()) ||
//     Number.isNaN(dueDate.getTime())
//   ) {
//     throw createError("Valid invoiceDate and dueDate are required");
//   }

//   if (dueDate < invoiceDate) {
//     throw createError("Due date cannot be before invoice date");
//   }

//   if (!["NONE", "INTRA_STATE", "INTER_STATE"].includes(payload.taxMode)) {
//     throw createError("Invalid taxMode");
//   }

//   if (
//     !Array.isArray(payload.items) ||
//     !payload.items.length ||
//     payload.items.length > 200
//   ) {
//     throw createError("An invoice requires between 1 and 200 items");
//   }

//   const productIds = payload.items.map((item) => {
//     validateObjectId(item.productId, "productId");
//     return String(item.productId).toLowerCase();
//   });

//   if (new Set(productIds).size !== productIds.length) {
//     throw createError("A product can appear only once in an invoice");
//   }

//   const products = await Product.find({
//     _id: { $in: productIds },
//     tenantId,
//     status: "ACTIVE",
//     isDeleted: false,
//   })
//     .session(session)
//     .lean();

//   if (products.length !== productIds.length) {
//     throw createError(
//       "One or more products are missing, inactive, or belong to another tenant",
//       409,
//     );
//   }

//   const productMap = new Map(
//     products.map((product) => [String(product._id), product]),
//   );

//   const salesLedgerCache = new Map();

//   const totals = {
//     grossAmountPaise: 0,
//     discountAmountPaise: 0,
//     taxableAmountPaise: 0,
//     cgstAmountPaise: 0,
//     sgstAmountPaise: 0,
//     igstAmountPaise: 0,
//     totalAmountPaise: 0,
//   };

//   const items = [];

//   for (const input of payload.items) {
//     const product = productMap.get(String(input.productId).toLowerCase());

//     const quantityMilli = scaledNumber({
//       value: input.quantity,
//       scale: 1000,
//       minimum: 0.001,
//       maximum: 1000000,
//       fieldName: `Quantity for ${product.name}`,
//     });

//     const discountBasisPoints = scaledNumber({
//       value: input.discountPercent ?? 0,
//       scale: 100,
//       minimum: 0,
//       maximum: 100,
//       fieldName: `Discount for ${product.name}`,
//     });

//     if (typeof input.unitRate !== "number" || input.unitRate > 1000000000) {
//       throw createError(`Invalid unit rate for ${product.name}`);
//     }

//     const unitRatePaise = rupeesToPaise(
//       input.unitRate,
//       `Unit rate for ${product.name}`,
//     );

//     const gstRate = input.gstRate ?? product.gstRate;

//     if (![0, 3, 5, 12, 18, 28].includes(gstRate)) {
//       throw createError(`Invalid GST rate for ${product.name}`);
//     }

//     if (payload.taxMode === "NONE" && gstRate !== 0) {
//       throw createError(
//         `GST rate must be zero for ${product.name} when taxMode is NONE`,
//       );
//     }

//     const cacheKey = product.salesLedgerId
//       ? String(product.salesLedgerId)
//       : "DEFAULT_SALES";

//     if (!salesLedgerCache.has(cacheKey)) {
//       const ledger = await getSalesLedger({
//         tenantId,
//         ledgerId: product.salesLedgerId,
//         session,
//       });

//       salesLedgerCache.set(cacheKey, ledger);
//     }

//     const salesLedger = salesLedgerCache.get(cacheKey);

//     const grossAmountPaise = multiplyDivide(unitRatePaise, quantityMilli, 1000);

//     const discountAmountPaise = multiplyDivide(
//       grossAmountPaise,
//       discountBasisPoints,
//       10000,
//     );

//     const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

//     const taxAmountPaise = multiplyDivide(taxableAmountPaise, gstRate, 100);

//     let cgstAmountPaise = 0;
//     let sgstAmountPaise = 0;
//     let igstAmountPaise = 0;

//     if (payload.taxMode === "INTRA_STATE") {
//       cgstAmountPaise = Math.floor(taxAmountPaise / 2);
//       sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
//     } else if (payload.taxMode === "INTER_STATE") {
//       igstAmountPaise = taxAmountPaise;
//     }

//     const totalAmountPaise = addAmounts(taxableAmountPaise, taxAmountPaise);

//     const item = {
//       productId: product._id,
//       productCode: product.productCode,
//       productName: product.name,
//       productType: product.type,
//       trackInventory:
//         product.type === "GOODS" && Boolean(product.trackInventory),
//       unit: product.unit,
//       hsnSacCode: product.hsnSacCode || null,
//       quantity: quantityMilli / 1000,
//       unitRatePaise,
//       discountPercent: discountBasisPoints / 100,
//       gstRate,
//       salesLedgerId: salesLedger._id,
//       grossAmountPaise,
//       discountAmountPaise,
//       taxableAmountPaise,
//       cgstAmountPaise,
//       sgstAmountPaise,
//       igstAmountPaise,
//       totalAmountPaise,
//     };

//     items.push(item);

//     for (const field of Object.keys(totals)) {
//       totals[field] = addAmounts(totals[field], item[field]);
//     }
//   }

//   return {
//     customerId: customer._id,
//     customerCode: customer.customerCode,
//     customerName: customer.customerName,
//     customerLedgerId: customer.ledgerId,
//     customerGstNo: customer.gstNo || null,

//     invoiceDate,
//     dueDate,
//     currency: "INR",

//     paymentTerms:
//       normalizeText(payload.paymentTerms) ||
//       customer.paymentTerms ||
//       "Due on Receipt",

//     taxMode: payload.taxMode,
//     updateStock: payload.updateStock ?? false,

//     items,
//     ...totals,

//     paidAmountPaise: 0,
//     outstandingAmountPaise: totals.totalAmountPaise,
//     paymentStatus: "UNPAID",

//     notes: normalizeText(payload.notes) || null,
//   };
// };

// const getDraftForUpdate = async ({ tenantId, invoiceNumber, session }) => {
//   const invoice = await SalesInvoice.findOne({
//     tenantId,
//     invoiceNumber: normalizeCode(invoiceNumber),
//     isDeleted: false,
//   }).session(session);

//   if (!invoice) {
//     throw createError("Sales invoice not found", 404);
//   }

//   if (invoice.status !== "DRAFT") {
//     throw createError(
//       "Only draft sales invoices can be edited, posted, or deleted",
//       409,
//     );
//   }

//   return invoice;
// };

// const createAudit = async ({
//   tenantId,
//   userId,
//   action,
//   invoice,
//   oldData = null,
//   ipAddress,
//   session,
// }) => {
//   await AuditLog.create(
//     [
//       {
//         tenantId,
//         userId,
//         action,
//         module: "SALES_INVOICE",
//         documentId: invoice._id,
//         oldData,
//         newData: invoice.toObject(),
//         ipAddress,
//       },
//     ],
//     { session, ordered: true },
//   );
// };

// const buildJournalLines = async ({ tenantId, invoice, session }) => {
//   const incomeAmounts = new Map();

//   const outputTaxes = {
//     OUTPUT_CGST: 0,
//     OUTPUT_SGST: 0,
//     OUTPUT_IGST: 0,
//   };

//   for (const item of invoice.items) {
//     const ledgerId = String(item.salesLedgerId);

//     incomeAmounts.set(
//       ledgerId,
//       addAmounts(incomeAmounts.get(ledgerId) || 0, item.taxableAmountPaise),
//     );

//     outputTaxes.OUTPUT_CGST = addAmounts(
//       outputTaxes.OUTPUT_CGST,
//       item.cgstAmountPaise,
//     );

//     outputTaxes.OUTPUT_SGST = addAmounts(
//       outputTaxes.OUTPUT_SGST,
//       item.sgstAmountPaise,
//     );

//     outputTaxes.OUTPUT_IGST = addAmounts(
//       outputTaxes.OUTPUT_IGST,
//       item.igstAmountPaise,
//     );
//   }

//   const lines = [];

//   for (const [ledgerId, amount] of incomeAmounts) {
//     if (!amount) continue;

//     await getSalesLedger({
//       tenantId,
//       ledgerId,
//       session,
//     });

//     lines.push({
//       ledgerId,
//       debitPaise: 0,
//       creditPaise: amount,
//     });
//   }

//   for (const [code, amount] of Object.entries(outputTaxes)) {
//     if (!amount) continue;

//     const ledger = await getOutputTaxLedger({
//       tenantId,
//       code,
//       session,
//     });

//     lines.push({
//       ledgerId: ledger._id,
//       debitPaise: 0,
//       creditPaise: amount,
//     });
//   }

//   lines.push({
//     ledgerId: invoice.customerLedgerId,
//     debitPaise: invoice.totalAmountPaise,
//     creditPaise: 0,
//   });

//   return lines;
// };

// const postInvoiceInTransaction = async ({
//   tenantId,
//   userId,
//   invoice,
//   ipAddress,
//   session,
// }) => {
//   if (invoice.status !== "DRAFT" || invoice.isDeleted) {
//     throw createError("Only an active draft can be posted", 409);
//   }

//   if (invoice.totalAmountPaise <= 0) {
//     throw createError("An invoice must have a positive total to be posted");
//   }

//   const oldData = invoice.toObject();

//   const customer = await getCustomer({
//     tenantId,
//     customerId: invoice.customerId,
//     session,
//   });

//   if (String(customer.ledgerId) !== String(invoice.customerLedgerId)) {
//     throw createError(
//       "Customer ledger has changed. Update the draft before posting.",
//       409,
//     );
//   }

//   const lines = await buildJournalLines({
//     tenantId,
//     invoice,
//     session,
//   });

//   const journal = await postJournal({
//     tenantId,
//     userId,
//     postingDate: invoice.invoiceDate,
//     sourceType: "SALES_INVOICE",
//     sourceId: invoice._id,
//     sourceNumber: invoice.invoiceNumber,
//     narration: `Sales invoice ${invoice.invoiceNumber} — ${invoice.customerName}`,
//     lines,
//     session,
//   });

//   if (invoice.updateStock) {
//     for (const item of invoice.items) {
//       if (!item.trackInventory) continue;

//       await stockMovementService.createStockMovement({
//         tenantId,
//         userId,
//         productId: item.productId,
//         movementType: "SALE",
//         quantity: item.quantity,
//         unitRate: paiseToRupees(item.unitRatePaise),
//         referenceType: "SALES_INVOICE",
//         referenceId: invoice._id,
//         referenceNumber: invoice.invoiceNumber,
//         movementDate: invoice.invoiceDate,
//         notes: `Sales invoice ${invoice.invoiceNumber}`,
//         session,
//       });
//     }
//   }

//   const customerLedger = await Ledger.findOne({
//     _id: invoice.customerLedgerId,
//     tenantId,
//   })
//     .session(session)
//     .lean();

//   if (!customerLedger) {
//     throw createError("Customer ledger was not found after posting", 409);
//   }

//   customer.receivableBalance =
//     customerLedger.currentBalanceType === "DEBIT"
//       ? customerLedger.currentBalance
//       : 0;

//   await customer.save({ session });

//   invoice.status = "POSTED";
//   invoice.journalId = journal._id;
//   invoice.postedAt = new Date();
//   invoice.postedBy = userId;
//   invoice.updatedBy = userId;

//   await invoice.save({ session });

//   await createAudit({
//     tenantId,
//     userId,
//     action: "POST",
//     invoice,
//     oldData,
//     ipAddress,
//     session,
//   });

//   return invoice;
// };

// const notifyInvoicePosted = async ({ tenantId, userId, invoice }) => {
//   try {
//     await NotificationService.create({
//       tenantId,
//       userId,
//       type: "SALES_INVOICE",
//       title: "Sales invoice posted",
//       message:
//         `${invoice.invoiceNumber} for ${invoice.customerName} ` +
//         "was posted successfully.",
//       icon: "file-text",
//       priority: "NORMAL",
//       route: "/sales/invoices",
//       data: {
//         salesInvoiceId: invoice._id.toString(),
//         invoiceNumber: invoice.invoiceNumber,
//         customerId: invoice.customerId.toString(),
//         totalAmountPaise: invoice.totalAmountPaise,
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Sales invoice notification failed:",
//       error?.message || error,
//     );
//   }
// };

// const translateDuplicateError = (error) => {
//   if (error?.code === 11000) {
//     return createError("Sales invoice number already exists", 409);
//   }

//   return error;
// };

// const createSalesInvoice = async ({ tenantId, userId, payload, ipAddress }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const invoiceData = await calculateInvoice({
//         tenantId,
//         payload,
//         session,
//       });

//       const invoiceNumber = await getNextSequence("SI", tenantId.toString());

//       const records = await SalesInvoice.create(
//         [
//           {
//             ...invoiceData,
//             tenantId,
//             invoiceNumber,
//             status: "DRAFT",
//             createdBy: userId,
//             updatedBy: userId,
//           },
//         ],
//         { session, ordered: true },
//       );

//       const invoice = records[0];

//       await createAudit({
//         tenantId,
//         userId,
//         action: "CREATE",
//         invoice,
//         ipAddress,
//         session,
//       });

//       if (payload.action === "SAVE_AND_POST") {
//         await postInvoiceInTransaction({
//           tenantId,
//           userId,
//           invoice,
//           ipAddress,
//           session,
//         });
//       }

//       result = invoice.toObject();
//     });

//     if (result.status === "POSTED") {
//       await notifyInvoicePosted({
//         tenantId,
//         userId,
//         invoice: result,
//       });
//     }

//     return result;
//   } catch (error) {
//     throw translateDuplicateError(error);
//   } finally {
//     await session.endSession();
//   }
// };

// const updateSalesInvoice = async ({
//   tenantId,
//   userId,
//   invoiceNumber,
//   payload,
//   ipAddress,
// }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const invoice = await getDraftForUpdate({
//         tenantId,
//         invoiceNumber,
//         session,
//       });

//       const oldData = invoice.toObject();

//       const invoiceData = await calculateInvoice({
//         tenantId,
//         payload,
//         session,
//       });

//       invoice.set(invoiceData);
//       invoice.updatedBy = userId;

//       await invoice.save({ session });

//       await createAudit({
//         tenantId,
//         userId,
//         action: "UPDATE",
//         invoice,
//         oldData,
//         ipAddress,
//         session,
//       });

//       result = invoice.toObject();
//     });

//     return result;
//   } catch (error) {
//     throw translateDuplicateError(error);
//   } finally {
//     await session.endSession();
//   }
// };

// const postSalesInvoice = async ({
//   tenantId,
//   userId,
//   invoiceNumber,
//   ipAddress,
// }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const invoice = await getDraftForUpdate({
//         tenantId,
//         invoiceNumber,
//         session,
//       });

//       await postInvoiceInTransaction({
//         tenantId,
//         userId,
//         invoice,
//         ipAddress,
//         session,
//       });

//       result = invoice.toObject();
//     });

//     await notifyInvoicePosted({
//       tenantId,
//       userId,
//       invoice: result,
//     });

//     return result;
//   } catch (error) {
//     throw translateDuplicateError(error);
//   } finally {
//     await session.endSession();
//   }
// };

// const deleteSalesInvoice = async ({
//   tenantId,
//   userId,
//   invoiceNumber,
//   ipAddress,
// }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const invoice = await getDraftForUpdate({
//         tenantId,
//         invoiceNumber,
//         session,
//       });

//       const oldData = invoice.toObject();

//       invoice.isDeleted = true;
//       invoice.deletedAt = new Date();
//       invoice.deletedBy = userId;
//       invoice.updatedBy = userId;

//       await invoice.save({ session });

//       await createAudit({
//         tenantId,
//         userId,
//         action: "DELETE",
//         invoice,
//         oldData,
//         ipAddress,
//         session,
//       });

//       result = invoice.toObject();
//     });

//     return result;
//   } finally {
//     await session.endSession();
//   }
// };

// const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const getSalesInvoices = async ({
//   tenantId,
//   search = "",
//   customerId,
//   status,
//   paymentStatus,
//   fromDate,
//   toDate,
//   page = 1,
//   limit = 20,
// }) => {
//   const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

//   const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

//   const filter = {
//     tenantId,
//     isDeleted: false,
//   };

//   if (customerId) {
//     validateObjectId(customerId, "customerId");
//     filter.customerId = customerId;
//   }

//   if (status) {
//     filter.status = status;
//   }

//   if (paymentStatus) {
//     filter.paymentStatus = paymentStatus;
//   }

//   if (fromDate || toDate) {
//     filter.invoiceDate = {};

//     if (fromDate) {
//       filter.invoiceDate.$gte = new Date(fromDate);
//     }

//     if (toDate) {
//       filter.invoiceDate.$lte = new Date(toDate);
//     }
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     const regex = {
//       $regex: escapeRegex(searchText),
//       $options: "i",
//     };

//     filter.$or = [
//       { invoiceNumber: regex },
//       { customerName: regex },
//       { customerCode: regex },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     SalesInvoice.find(filter)
//       .select("-items")
//       .sort({ invoiceDate: -1, createdAt: -1 })
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

// const getSalesInvoiceByNumber = async ({ tenantId, invoiceNumber }) => {
//   const invoice = await SalesInvoice.findOne({
//     tenantId,
//     invoiceNumber: normalizeCode(invoiceNumber),
//     isDeleted: false,
//   }).lean();

//   if (!invoice) {
//     throw createError("Sales invoice not found", 404);
//   }

//   return invoice;
// };

// module.exports = {
//   createSalesInvoice,
//   updateSalesInvoice,
//   postSalesInvoice,
//   deleteSalesInvoice,
//   getSalesInvoices,
//   getSalesInvoiceByNumber,
// };

const mongoose = require("mongoose");

const {
  getTenantAccountingModels,
} = require("../../tenancy/tenantAccountingModels");

const {
  getReadyTenantConnection,
} = require("../../tenancy/tenantConnectionManager");

const {
  postJournal,
  rupeesToPaise,
  paiseToRupees,
} = require("../accounting/journals/journal.service");

const stockMovementService = require("../stock-movements/stockMovement.service");

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

const assertSafeAmount = (value, fieldName = "Amount") => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createError(`${fieldName} exceeds the supported range`);
  }

  return value;
};

const addAmounts = (first, second) => assertSafeAmount(first + second);

const multiplyDivide = (first, second, divisor) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw createError("Invalid calculation divisor");
  }

  const numerator = BigInt(first) * BigInt(second);
  const denominator = BigInt(divisor);
  const rounded = (numerator + denominator / 2n) / denominator;

  return assertSafeAmount(Number(rounded));
};

const scaledNumber = ({
  value,
  scale,
  minimum,
  maximum,
  fieldName,
}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError(`${fieldName} must be a valid number`);
  }

  if (value < minimum || value > maximum) {
    throw createError(
      `${fieldName} must be between ${minimum} and ${maximum}`,
    );
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  if (
    !Number.isSafeInteger(integer) ||
    Math.abs(scaled - integer) > 0.000001
  ) {
    throw createError(`${fieldName} has too many decimal places`);
  }

  return integer;
};

const getCustomer = async ({
  models,
  tenantId,
  customerId,
  session,
}) => {
  const { Customer, Ledger } = models;

  validateObjectId(customerId, "customerId");

  const customer = await Customer.findOne({
    _id: customerId,
    tenantId,
    isDeleted: false,
    status: "Active",
  }).session(session);

  if (!customer) {
    throw createError("Active customer not found", 404);
  }

  if (!customer.ledgerId) {
    throw createError(
      "Customer does not have a linked receivable ledger",
      409,
    );
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

  return customer;
};

const getSalesLedger = async ({
  models,
  tenantId,
  ledgerId,
  session,
}) => {
  const { Ledger } = models;

  const filter = {
    tenantId,
    isActive: true,
    nature: "INCOME",
    type: { $in: ["ACCOUNT", "SYSTEM"] },
  };

  if (ledgerId) {
    filter._id = ledgerId;
  } else {
    filter.code = "SALES";
  }

  const ledger = await Ledger.findOne(filter)
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(
      ledgerId
        ? "The product sales ledger is missing, inactive, or not an income ledger"
        : "The active SALES income ledger is missing. Seed accounting ledgers first.",
      409,
    );
  }

  return ledger;
};

const getOutputTaxLedger = async ({
  models,
  tenantId,
  code,
  session,
}) => {
  const { Ledger } = models;

  const ledger = await Ledger.findOne({
    tenantId,
    code,
    type: "TAX",
    nature: "LIABILITY",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(
      `Active ${code} output tax ledger is missing. Seed accounting ledgers first.`,
      409,
    );
  }

  return ledger;
};

const calculateInvoice = async ({
  models,
  tenantId,
  payload,
  session,
}) => {
  const { Product } = models;

  const customer = await getCustomer({
    models,
    tenantId,
    customerId: payload.customerId,
    session,
  });

  const invoiceDate = new Date(payload.invoiceDate);
  const dueDate = new Date(payload.dueDate);

  if (
    !payload.invoiceDate ||
    !payload.dueDate ||
    Number.isNaN(invoiceDate.getTime()) ||
    Number.isNaN(dueDate.getTime())
  ) {
    throw createError("Valid invoiceDate and dueDate are required");
  }

  if (dueDate < invoiceDate) {
    throw createError("Due date cannot be before invoice date");
  }

  if (!["NONE", "INTRA_STATE", "INTER_STATE"].includes(payload.taxMode)) {
    throw createError("Invalid taxMode");
  }

  if (
    !Array.isArray(payload.items) ||
    !payload.items.length ||
    payload.items.length > 200
  ) {
    throw createError("An invoice requires between 1 and 200 items");
  }

  const productIds = payload.items.map((item) => {
    validateObjectId(item.productId, "productId");
    return String(item.productId).toLowerCase();
  });

  if (new Set(productIds).size !== productIds.length) {
    throw createError("A product can appear only once in an invoice");
  }

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError(
      "One or more products are missing, inactive, or belong to another tenant",
      409,
    );
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  const salesLedgerCache = new Map();

  const totals = {
    grossAmountPaise: 0,
    discountAmountPaise: 0,
    taxableAmountPaise: 0,
    cgstAmountPaise: 0,
    sgstAmountPaise: 0,
    igstAmountPaise: 0,
    totalAmountPaise: 0,
  };

  const items = [];

  for (const input of payload.items) {
    const product = productMap.get(
      String(input.productId).toLowerCase(),
    );

    const quantityMilli = scaledNumber({
      value: input.quantity,
      scale: 1000,
      minimum: 0.001,
      maximum: 1000000,
      fieldName: `Quantity for ${product.name}`,
    });

    const discountBasisPoints = scaledNumber({
      value: input.discountPercent ?? 0,
      scale: 100,
      minimum: 0,
      maximum: 100,
      fieldName: `Discount for ${product.name}`,
    });

    if (
      typeof input.unitRate !== "number" ||
      input.unitRate > 1000000000
    ) {
      throw createError(`Invalid unit rate for ${product.name}`);
    }

    const unitRatePaise = rupeesToPaise(
      input.unitRate,
      `Unit rate for ${product.name}`,
    );

    const gstRate = input.gstRate ?? product.gstRate;

    if (![0, 3, 5, 12, 18, 28].includes(gstRate)) {
      throw createError(`Invalid GST rate for ${product.name}`);
    }

    if (payload.taxMode === "NONE" && gstRate !== 0) {
      throw createError(
        `GST rate must be zero for ${product.name} when taxMode is NONE`,
      );
    }

    const cacheKey = product.salesLedgerId
      ? String(product.salesLedgerId)
      : "DEFAULT_SALES";

    if (!salesLedgerCache.has(cacheKey)) {
      const ledger = await getSalesLedger({
        models,
        tenantId,
        ledgerId: product.salesLedgerId,
        session,
      });

      salesLedgerCache.set(cacheKey, ledger);
    }

    const salesLedger = salesLedgerCache.get(cacheKey);

    const grossAmountPaise = multiplyDivide(
      unitRatePaise,
      quantityMilli,
      1000,
    );

    const discountAmountPaise = multiplyDivide(
      grossAmountPaise,
      discountBasisPoints,
      10000,
    );

    const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

    const taxAmountPaise = multiplyDivide(
      taxableAmountPaise,
      gstRate,
      100,
    );

    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    if (payload.taxMode === "INTRA_STATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);
      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (payload.taxMode === "INTER_STATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const totalAmountPaise = addAmounts(
      taxableAmountPaise,
      taxAmountPaise,
    );

    const item = {
      productId: product._id,
      productCode: product.productCode,
      productName: product.name,
      productType: product.type,
      trackInventory:
        product.type === "GOODS" && Boolean(product.trackInventory),
      unit: product.unit,
      hsnSacCode: product.hsnSacCode || null,
      quantity: quantityMilli / 1000,
      unitRatePaise,
      discountPercent: discountBasisPoints / 100,
      gstRate,
      salesLedgerId: salesLedger._id,
      grossAmountPaise,
      discountAmountPaise,
      taxableAmountPaise,
      cgstAmountPaise,
      sgstAmountPaise,
      igstAmountPaise,
      totalAmountPaise,
    };

    items.push(item);

    for (const field of Object.keys(totals)) {
      totals[field] = addAmounts(totals[field], item[field]);
    }
  }

  return {
    customerId: customer._id,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    customerLedgerId: customer.ledgerId,
    customerGstNo: customer.gstNo || null,

    invoiceDate,
    dueDate,
    currency: "INR",

    paymentTerms:
      normalizeText(payload.paymentTerms) ||
      customer.paymentTerms ||
      "Due on Receipt",

    taxMode: payload.taxMode,
    updateStock: payload.updateStock ?? false,

    items,
    ...totals,

    paidAmountPaise: 0,
    outstandingAmountPaise: totals.totalAmountPaise,
    paymentStatus: "UNPAID",

    notes: normalizeText(payload.notes) || null,
  };
};

const getDraftForUpdate = async ({
  models,
  tenantId,
  invoiceNumber,
  session,
}) => {
  const { SalesInvoice } = models;

  const invoice = await SalesInvoice.findOne({
    tenantId,
    invoiceNumber: normalizeCode(invoiceNumber),
    isDeleted: false,
  }).session(session);

  if (!invoice) {
    throw createError("Sales invoice not found", 404);
  }

  if (invoice.status !== "DRAFT") {
    throw createError(
      "Only draft sales invoices can be edited, posted, or deleted",
      409,
    );
  }

  return invoice;
};

const createAudit = async ({
  models,
  tenantId,
  userId,
  action,
  invoice,
  oldData = null,
  ipAddress,
  session,
}) => {
  const { AuditLog } = models;

  await AuditLog.create(
    [
      {
        tenantId,
        userId,
        action,
        module: "SALES_INVOICE",
        documentId: invoice._id,
        oldData,
        newData: invoice.toObject(),
        ipAddress,
      },
    ],
    { session, ordered: true },
  );
};

const buildJournalLines = async ({
  models,
  tenantId,
  invoice,
  session,
}) => {
  const incomeAmounts = new Map();

  const outputTaxes = {
    OUTPUT_CGST: 0,
    OUTPUT_SGST: 0,
    OUTPUT_IGST: 0,
  };

  for (const item of invoice.items) {
    const ledgerId = String(item.salesLedgerId);

    incomeAmounts.set(
      ledgerId,
      addAmounts(
        incomeAmounts.get(ledgerId) || 0,
        item.taxableAmountPaise,
      ),
    );

    outputTaxes.OUTPUT_CGST = addAmounts(
      outputTaxes.OUTPUT_CGST,
      item.cgstAmountPaise,
    );

    outputTaxes.OUTPUT_SGST = addAmounts(
      outputTaxes.OUTPUT_SGST,
      item.sgstAmountPaise,
    );

    outputTaxes.OUTPUT_IGST = addAmounts(
      outputTaxes.OUTPUT_IGST,
      item.igstAmountPaise,
    );
  }

  const lines = [];

  for (const [ledgerId, amount] of incomeAmounts) {
    if (!amount) continue;

    await getSalesLedger({
      models,
      tenantId,
      ledgerId,
      session,
    });

    lines.push({
      ledgerId,
      debitPaise: 0,
      creditPaise: amount,
    });
  }

  for (const [code, amount] of Object.entries(outputTaxes)) {
    if (!amount) continue;

    const ledger = await getOutputTaxLedger({
      models,
      tenantId,
      code,
      session,
    });

    lines.push({
      ledgerId: ledger._id,
      debitPaise: 0,
      creditPaise: amount,
    });
  }

  lines.push({
    ledgerId: invoice.customerLedgerId,
    debitPaise: invoice.totalAmountPaise,
    creditPaise: 0,
  });

  return lines;
};

const postInvoiceInTransaction = async ({
  models,
  connection,
  tenant,
  tenantId,
  userId,
  invoice,
  ipAddress,
  session,
}) => {
  const { Ledger } = models;

  if (invoice.status !== "DRAFT" || invoice.isDeleted) {
    throw createError("Only an active draft can be posted", 409);
  }

  if (invoice.totalAmountPaise <= 0) {
    throw createError(
      "An invoice must have a positive total to be posted",
    );
  }

  const oldData = invoice.toObject();

  const customer = await getCustomer({
    models,
    tenantId,
    customerId: invoice.customerId,
    session,
  });

  if (String(customer.ledgerId) !== String(invoice.customerLedgerId)) {
    throw createError(
      "Customer ledger has changed. Update the draft before posting.",
      409,
    );
  }

  const lines = await buildJournalLines({
    models,
    tenantId,
    invoice,
    session,
  });

  const journal = await postJournal({
    tenant,
    connection,
    userId,
    postingDate: invoice.invoiceDate,
    sourceType: "SALES_INVOICE",
    sourceId: invoice._id,
    sourceNumber: invoice.invoiceNumber,
    narration: `Sales invoice ${invoice.invoiceNumber} — ${invoice.customerName}`,
    lines,
    session,
  });

  if (invoice.updateStock) {
    for (const item of invoice.items) {
      if (!item.trackInventory) continue;

      await stockMovementService.createStockMovement({
        tenant,
        connection,
        userId,
        productId: item.productId,
        movementType: "SALE",
        quantity: item.quantity,
        unitRate: paiseToRupees(item.unitRatePaise),
        referenceType: "SALES_INVOICE",
        referenceId: invoice._id,
        referenceNumber: invoice.invoiceNumber,
        movementDate: invoice.invoiceDate,
        notes: `Sales invoice ${invoice.invoiceNumber}`,
        session,
      });
    }
  }

  const customerLedger = await Ledger.findOne({
    _id: invoice.customerLedgerId,
    tenantId,
  })
    .session(session)
    .lean();

  if (!customerLedger) {
    throw createError("Customer ledger was not found after posting", 409);
  }

  customer.receivableBalance =
    customerLedger.currentBalanceType === "DEBIT"
      ? customerLedger.currentBalance
      : 0;

  await customer.save({ session });

  invoice.status = "POSTED";
  invoice.journalId = journal._id;
  invoice.postedAt = new Date();
  invoice.postedBy = userId;
  invoice.updatedBy = userId;

  await invoice.save({ session });

  await createAudit({
    models,
    tenantId,
    userId,
    action: "POST",
    invoice,
    oldData,
    ipAddress,
    session,
  });

  return invoice;
};

const notifyInvoicePosted = async ({
  tenantId,
  userId,
  invoice,
}) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,
      type: "SALES_INVOICE",
      title: "Sales invoice posted",
      message:
        `${invoice.invoiceNumber} for ${invoice.customerName} ` +
        "was posted successfully.",
      icon: "file-text",
      priority: "NORMAL",
      route: "/sales/invoices",
      data: {
        salesInvoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId.toString(),
        totalAmountPaise: invoice.totalAmountPaise,
      },
    });
  } catch (error) {
    console.error(
      "Sales invoice notification failed:",
      error?.message || error,
    );
  }
};

const translateDuplicateError = (error) => {
  if (error?.code === 11000) {
    return createError("Sales invoice number already exists", 409);
  }

  return error;
};

const createSalesInvoice = async ({
  tenant,
  userId,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const { SalesInvoice } = models;

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const invoiceData = await calculateInvoice({
        models,
        tenantId,
        payload,
        session,
      });

      const invoiceNumber = await getNextSequence(
        "SI",
        tenantId.toString(),
        3,
        {
          connection,
          session,
        },
      );

      const records = await SalesInvoice.create(
        [
          {
            ...invoiceData,
            tenantId,
            invoiceNumber,
            status: "DRAFT",
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        { session, ordered: true },
      );

      const invoice = records[0];

      await createAudit({
        models,
        tenantId,
        userId,
        action: "CREATE",
        invoice,
        ipAddress,
        session,
      });

      if (payload.action === "SAVE_AND_POST") {
        await postInvoiceInTransaction({
          models,
          connection,
          tenant,
          tenantId,
          userId,
          invoice,
          ipAddress,
          session,
        });
      }

      result = invoice.toObject();
    });

    if (result.status === "POSTED") {
      await notifyInvoicePosted({
        tenantId,
        userId,
        invoice: result,
      });
    }

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const updateSalesInvoice = async ({
  tenant,
  userId,
  invoiceNumber,
  payload,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const invoice = await getDraftForUpdate({
        models,
        tenantId,
        invoiceNumber,
        session,
      });

      const oldData = invoice.toObject();

      const invoiceData = await calculateInvoice({
        models,
        tenantId,
        payload,
        session,
      });

      invoice.set(invoiceData);
      invoice.updatedBy = userId;

      await invoice.save({ session });

      await createAudit({
        models,
        tenantId,
        userId,
        action: "UPDATE",
        invoice,
        oldData,
        ipAddress,
        session,
      });

      result = invoice.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const postSalesInvoice = async ({
  tenant,
  userId,
  invoiceNumber,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const invoice = await getDraftForUpdate({
        models,
        tenantId,
        invoiceNumber,
        session,
      });

      await postInvoiceInTransaction({
        models,
        connection,
        tenant,
        tenantId,
        userId,
        invoice,
        ipAddress,
        session,
      });

      result = invoice.toObject();
    });

    await notifyInvoicePosted({
      tenantId,
      userId,
      invoice: result,
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const deleteSalesInvoice = async ({
  tenant,
  userId,
  invoiceNumber,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const invoice = await getDraftForUpdate({
        models,
        tenantId,
        invoiceNumber,
        session,
      });

      const oldData = invoice.toObject();

      invoice.isDeleted = true;
      invoice.deletedAt = new Date();
      invoice.deletedBy = userId;
      invoice.updatedBy = userId;

      await invoice.save({ session });

      await createAudit({
        models,
        tenantId,
        userId,
        action: "DELETE",
        invoice,
        oldData,
        ipAddress,
        session,
      });

      result = invoice.toObject();
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSalesInvoices = async ({
  tenant,
  search = "",
  customerId,
  status,
  paymentStatus,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { SalesInvoice } = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(
    Math.max(Math.floor(Number(limit) || 20), 1),
    100,
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (customerId) {
    validateObjectId(customerId, "customerId");
    filter.customerId = customerId;
  }

  if (status) {
    filter.status = status;
  }

  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }

  if (fromDate || toDate) {
    filter.invoiceDate = {};

    if (fromDate) {
      filter.invoiceDate.$gte = new Date(fromDate);
    }

    if (toDate) {
      filter.invoiceDate.$lte = new Date(toDate);
    }
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    filter.$or = [
      { invoiceNumber: regex },
      { customerName: regex },
      { customerCode: regex },
    ];
  }

  const [data, total] = await Promise.all([
    SalesInvoice.find(filter)
      .select("-items")
      .sort({ invoiceDate: -1, createdAt: -1 })
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

const getSalesInvoiceByNumber = async ({
  tenant,
  invoiceNumber,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const { SalesInvoice } = getTenantAccountingModels(connection);

  const invoice = await SalesInvoice.findOne({
    tenantId: tenant._id,
    invoiceNumber: normalizeCode(invoiceNumber),
    isDeleted: false,
  }).lean();

  if (!invoice) {
    throw createError("Sales invoice not found", 404);
  }

  return invoice;
};

module.exports = {
  createSalesInvoice,
  updateSalesInvoice,
  postSalesInvoice,
  deleteSalesInvoice,
  getSalesInvoices,
  getSalesInvoiceByNumber,
};