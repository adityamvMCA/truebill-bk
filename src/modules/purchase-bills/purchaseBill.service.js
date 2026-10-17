// const mongoose = require("mongoose");

// const PurchaseBill = require("./purchaseBill.model");

// const Supplier = require("../suppliers/supplier.model");
// const Product = require("../products/product.model");

// const Ledger = require("../accounting/ledgers/ledger.model");
// const SupplierPayment = require("../supplier-payments/supplierPayment.model");
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

// // Exact non-negative integer multiplication/division,
// // rounded half-up without floating-point intermediate products.
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

// const getPurchaseLedger = async ({ tenantId, ledgerId, session }) => {
//   const filter = {
//     tenantId,
//     isActive: true,
//     nature: "EXPENSE",
//     type: { $in: ["ACCOUNT", "SYSTEM"] },
//   };

//   if (ledgerId) {
//     filter._id = ledgerId;
//   } else {
//     filter.code = "PURCHASE";
//   }

//   const ledger = await Ledger.findOne(filter).session(session).lean();

//   if (!ledger) {
//     throw createError(
//       ledgerId
//         ? "The product purchase ledger is missing, inactive, or not an expense ledger"
//         : "The active PURCHASE expense ledger is missing. Seed accounting ledgers first.",
//       409,
//     );
//   }

//   return ledger;
// };

// const getSupplier = async ({ tenantId, supplierId, session }) => {
//   validateObjectId(supplierId, "supplierId");

//   const supplier = await Supplier.findOne({
//     _id: supplierId,
//     tenantId,
//     isDeleted: false,
//     status: "Active",
//   }).session(session);

//   if (!supplier) {
//     throw createError("Active supplier not found", 404);
//   }

//   if (!supplier.ledgerId) {
//     throw createError("Supplier does not have a linked ledger", 409);
//   }

//   const ledger = await Ledger.findOne({
//     _id: supplier.ledgerId,
//     tenantId,
//     type: "SUPPLIER",
//     nature: "LIABILITY",
//     referenceType: "SUPPLIER",
//     referenceId: supplier._id,
//     isActive: true,
//   })
//     .session(session)
//     .lean();

//   if (!ledger) {
//     throw createError("The linked supplier ledger is missing or inactive", 409);
//   }

//   return supplier;
// };

// const calculateBill = async ({ tenantId, payload, session }) => {
//   const supplier = await getSupplier({
//     tenantId,
//     supplierId: payload.supplierId,
//     session,
//   });

//   const supplierInvoiceNumber = normalizeText(payload.supplierInvoiceNumber);

//   if (!supplierInvoiceNumber || supplierInvoiceNumber.length > 100) {
//     throw createError("A valid supplier invoice number is required");
//   }

//   const billDate = new Date(payload.billDate);
//   const dueDate = new Date(payload.dueDate);

//   if (
//     !payload.billDate ||
//     !payload.dueDate ||
//     Number.isNaN(billDate.getTime()) ||
//     Number.isNaN(dueDate.getTime())
//   ) {
//     throw createError("Valid billDate and dueDate are required");
//   }

//   if (dueDate < billDate) {
//     throw createError("Due date cannot be before bill date");
//   }

//   if (!["NONE", "INTRA_STATE", "INTER_STATE"].includes(payload.taxMode)) {
//     throw createError("Invalid taxMode");
//   }

//   if (
//     !Array.isArray(payload.items) ||
//     !payload.items.length ||
//     payload.items.length > 200
//   ) {
//     throw createError("A bill requires between 1 and 200 items");
//   }

//   if (
//     payload.updateStock !== undefined &&
//     typeof payload.updateStock !== "boolean"
//   ) {
//     throw createError("updateStock must be a boolean");
//   }

//   const productIds = payload.items.map((item) => {
//     validateObjectId(item.productId, "productId");
//     return String(item.productId).toLowerCase();
//   });

//   if (new Set(productIds).size !== productIds.length) {
//     throw createError("A product can appear only once in a bill");
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

//   const purchaseLedgerCache = new Map();

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

//     const taxCreditEligible = input.taxCreditEligible ?? false;

//     if (typeof taxCreditEligible !== "boolean") {
//       throw createError("taxCreditEligible must be a boolean");
//     }

//     if (taxCreditEligible && !supplier.gstNo) {
//       throw createError(
//         "Supplier GST number is required when claiming input tax credit",
//       );
//     }

//     const cacheKey = product.purchaseLedgerId
//       ? String(product.purchaseLedgerId)
//       : "DEFAULT_PURCHASE";

//     if (!purchaseLedgerCache.has(cacheKey)) {
//       const ledger = await getPurchaseLedger({
//         tenantId,
//         ledgerId: product.purchaseLedgerId,
//         session,
//       });

//       purchaseLedgerCache.set(cacheKey, ledger);
//     }

//     const purchaseLedger = purchaseLedgerCache.get(cacheKey);

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
//       // Allocate any odd paise to SGST so totals remain exact.
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
//       taxCreditEligible,
//       purchaseLedgerId: purchaseLedger._id,
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
//     supplierId: supplier._id,
//     supplierCode: supplier.supplierCode,
//     supplierName: supplier.supplierName,
//     supplierLedgerId: supplier.ledgerId,
//     supplierGstNo: supplier.gstNo || null,

//     supplierInvoiceNumber,
//     supplierInvoiceNumberNormalized: supplierInvoiceNumber.toUpperCase(),

//     billDate,
//     dueDate,
//     currency: "INR",

//     paymentTerms:
//       normalizeText(payload.paymentTerms) ||
//       supplier.paymentTerms ||
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

// const ensureNoDuplicateInvoice = async ({
//   tenantId,
//   billData,
//   excludeId,
//   session,
// }) => {
//   const filter = {
//     tenantId,
//     supplierId: billData.supplierId,
//     supplierInvoiceNumberNormalized: billData.supplierInvoiceNumberNormalized,
//     isDeleted: false,
//   };

//   if (excludeId) {
//     filter._id = { $ne: excludeId };
//   }

//   const existing = await PurchaseBill.findOne(filter)
//     .session(session)
//     .select("_id")
//     .lean();

//   if (existing) {
//     throw createError(
//       "This supplier invoice number already exists for the supplier",
//       409,
//     );
//   }
// };

// const getDraftForUpdate = async ({ tenantId, billNumber, session }) => {
//   const bill = await PurchaseBill.findOne({
//     tenantId,
//     billNumber: normalizeCode(billNumber),
//     isDeleted: false,
//   }).session(session);

//   if (!bill) {
//     throw createError("Purchase bill not found", 404);
//   }

//   if (bill.status !== "DRAFT") {
//     throw createError(
//       "Only draft purchase bills can be edited, posted, or deleted",
//       409,
//     );
//   }

//   return bill;
// };

// const createAudit = async ({
//   tenantId,
//   userId,
//   action,
//   bill,
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
//         module: "PURCHASE_BILL",
//         documentId: bill._id,
//         oldData,
//         newData: bill.toObject(),
//         ipAddress,
//       },
//     ],
//     { session },
//   );
// };

// const getTaxLedger = async ({ tenantId, code, session }) => {
//   const ledger = await Ledger.findOne({
//     tenantId,
//     code,
//     type: "TAX",
//     nature: "ASSET",
//     isActive: true,
//   })
//     .session(session)
//     .lean();

//   if (!ledger) {
//     throw createError(
//       `Active ${code} tax ledger is missing. Seed accounting ledgers first.`,
//       409,
//     );
//   }

//   return ledger;
// };

// const buildJournalLines = async ({ tenantId, bill, session }) => {
//   const expenseAmounts = new Map();

//   const recoverableTaxes = {
//     INPUT_CGST: 0,
//     INPUT_SGST: 0,
//     INPUT_IGST: 0,
//   };

//   for (const item of bill.items) {
//     const taxAmount =
//       item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise;

//     const expenseAmount = item.taxCreditEligible
//       ? item.taxableAmountPaise
//       : addAmounts(item.taxableAmountPaise, taxAmount);

//     const ledgerId = String(item.purchaseLedgerId);

//     expenseAmounts.set(
//       ledgerId,
//       addAmounts(expenseAmounts.get(ledgerId) || 0, expenseAmount),
//     );

//     if (item.taxCreditEligible) {
//       recoverableTaxes.INPUT_CGST = addAmounts(
//         recoverableTaxes.INPUT_CGST,
//         item.cgstAmountPaise,
//       );

//       recoverableTaxes.INPUT_SGST = addAmounts(
//         recoverableTaxes.INPUT_SGST,
//         item.sgstAmountPaise,
//       );

//       recoverableTaxes.INPUT_IGST = addAmounts(
//         recoverableTaxes.INPUT_IGST,
//         item.igstAmountPaise,
//       );
//     }
//   }

//   const lines = [];

//   for (const [ledgerId, amount] of expenseAmounts) {
//     if (!amount) {
//       continue;
//     }

//     await getPurchaseLedger({
//       tenantId,
//       ledgerId,
//       session,
//     });

//     lines.push({
//       ledgerId,
//       debitPaise: amount,
//       creditPaise: 0,
//     });
//   }

//   for (const [code, amount] of Object.entries(recoverableTaxes)) {
//     if (!amount) {
//       continue;
//     }

//     const ledger = await getTaxLedger({
//       tenantId,
//       code,
//       session,
//     });

//     lines.push({
//       ledgerId: ledger._id,
//       debitPaise: amount,
//       creditPaise: 0,
//     });
//   }

//   lines.push({
//     ledgerId: bill.supplierLedgerId,
//     debitPaise: 0,
//     creditPaise: bill.totalAmountPaise,
//   });

//   return lines;
// };

// const postBillInTransaction = async ({
//   tenantId,
//   userId,
//   bill,
//   ipAddress,
//   session,
// }) => {
//   if (bill.status !== "DRAFT" || bill.isDeleted) {
//     throw createError("Only an active draft can be posted", 409);
//   }

//   if (bill.totalAmountPaise <= 0) {
//     throw createError("A bill must have a positive total to be posted");
//   }

//   const oldData = bill.toObject();

//   const supplier = await getSupplier({
//     tenantId,
//     supplierId: bill.supplierId,
//     session,
//   });

//   if (String(supplier.ledgerId) !== String(bill.supplierLedgerId)) {
//     throw createError(
//       "Supplier ledger has changed. Update the draft before posting.",
//       409,
//     );
//   }

//   // Reject stale inventory settings instead of silently receiving stock
//   // using different settings from those saved on the draft.
//   const productIds = bill.items.map((item) => item.productId);

//   const products = await Product.find({
//     _id: { $in: productIds },
//     tenantId,
//     status: "ACTIVE",
//     isDeleted: false,
//   })
//     .session(session)
//     .lean();

//   if (products.length !== productIds.length) {
//     throw createError("One or more bill products are no longer active", 409);
//   }

//   const productMap = new Map(
//     products.map((product) => [String(product._id), product]),
//   );

//   for (const item of bill.items) {
//     const product = productMap.get(String(item.productId));

//     const tracksStock =
//       product.type === "GOODS" && Boolean(product.trackInventory);

//     if (
//       product.type !== item.productType ||
//       tracksStock !== item.trackInventory ||
//       product.unit !== item.unit
//     ) {
//       throw createError(
//         `Product settings changed for ${item.productName}. Update the draft before posting.`,
//         409,
//       );
//     }
//   }

//   const lines = await buildJournalLines({
//     tenantId,
//     bill,
//     session,
//   });

//   const journal = await postJournal({
//     tenantId,
//     userId,
//     postingDate: bill.billDate,
//     sourceType: "PURCHASE_BILL",
//     sourceId: bill._id,
//     sourceNumber: bill.billNumber,
//     narration: `Purchase bill ${bill.billNumber} — ${bill.supplierName}`,
//     lines,
//     session,
//   });

//   if (bill.updateStock) {
//     for (const item of bill.items) {
//       if (!item.trackInventory) {
//         continue;
//       }

//       const quantityMilli = Math.round(item.quantity * 1000);

//       const stockValuePaise = item.taxCreditEligible
//         ? item.taxableAmountPaise
//         : item.totalAmountPaise;

//       // Existing StockMovement stores unitRate in rupees with 2 decimals.
//       const stockUnitRatePaise = multiplyDivide(
//         stockValuePaise,
//         1000,
//         quantityMilli,
//       );

//       await stockMovementService.createStockMovement({
//         tenantId,
//         userId,
//         productId: item.productId,
//         movementType: "PURCHASE",
//         quantity: item.quantity,
//         unitRate: paiseToRupees(stockUnitRatePaise),
//         referenceType: "PURCHASE_BILL",
//         referenceId: bill._id,
//         referenceNumber: bill.billNumber,
//         movementDate: bill.billDate,
//         notes: `Purchase bill ${bill.billNumber}`,
//         session,
//       });
//     }
//   }

//   // Read the balance after journal posting.
//   const supplierLedger = await Ledger.findOne({
//     _id: bill.supplierLedgerId,
//     tenantId,
//   })
//     .session(session)
//     .lean();

//   if (!supplierLedger) {
//     throw createError("Supplier ledger was not found after posting", 409);
//   }

//   // payableBalance represents money owed, not supplier advances.
//   supplier.payableBalance =
//     supplierLedger.currentBalanceType === "CREDIT"
//       ? supplierLedger.currentBalance
//       : 0;

//   await supplier.save({ session });

//   bill.status = "POSTED";
//   bill.journalId = journal._id;
//   bill.postedAt = new Date();
//   bill.postedBy = userId;
//   bill.updatedBy = userId;

//   await bill.save({ session });

//   await createAudit({
//     tenantId,
//     userId,
//     action: "POST",
//     bill,
//     oldData,
//     ipAddress,
//     session,
//   });

//   return bill;
// };

// const notifyBillPosted = async ({ tenantId, userId, bill }) => {
//   try {
//     await NotificationService.create({
//       tenantId,
//       userId,
//       type: "PURCHASE_BILL",
//       title: "Purchase bill posted",
//       message:
//         `${bill.billNumber} for ${bill.supplierName} ` +
//         "was posted successfully.",
//       icon: "purchase-order",
//       priority: "NORMAL",
//       route: "/purchase/invoices",
//       data: {
//         purchaseBillId: bill._id.toString(),
//         billNumber: bill.billNumber,
//         supplierId: bill.supplierId.toString(),
//         totalAmountPaise: bill.totalAmountPaise,
//       },
//     });
//   } catch (error) {
//     // The financial transaction is already committed.
//     console.error(
//       "Purchase bill notification failed:",
//       error?.message || error,
//     );
//   }
// };

// const translateDuplicateError = (error) => {
//   if (error?.code === 11000) {
//     return createError(
//       "Purchase bill number or supplier invoice number already exists",
//       409,
//     );
//   }

//   return error;
// };

// const createPurchaseBill = async ({ tenantId, userId, payload, ipAddress }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const billData = await calculateBill({
//         tenantId,
//         payload,
//         session,
//       });

//       await ensureNoDuplicateInvoice({
//         tenantId,
//         billData,
//         session,
//       });

//       const billNumber = await getNextSequence("PB", tenantId.toString());

//       const records = await PurchaseBill.create(
//         [
//           {
//             ...billData,
//             tenantId,
//             billNumber,
//             status: "DRAFT",
//             createdBy: userId,
//             updatedBy: userId,
//           },
//         ],
//         { session },
//       );

//       const bill = records[0];

//       await createAudit({
//         tenantId,
//         userId,
//         action: "CREATE",
//         bill,
//         ipAddress,
//         session,
//       });

//       if (payload.action === "SAVE_AND_POST") {
//         await postBillInTransaction({
//           tenantId,
//           userId,
//           bill,
//           ipAddress,
//           session,
//         });
//       }

//       result = bill.toObject();
//     });

//     if (result.status === "POSTED") {
//       await notifyBillPosted({
//         tenantId,
//         userId,
//         bill: result,
//       });
//     }

//     return result;
//   } catch (error) {
//     throw translateDuplicateError(error);
//   } finally {
//     await session.endSession();
//   }
// };

// const updatePurchaseBill = async ({
//   tenantId,
//   userId,
//   billNumber,
//   payload,
//   ipAddress,
// }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const bill = await getDraftForUpdate({
//         tenantId,
//         billNumber,
//         session,
//       });

//       const oldData = bill.toObject();

//       const billData = await calculateBill({
//         tenantId,
//         payload,
//         session,
//       });

//       await ensureNoDuplicateInvoice({
//         tenantId,
//         billData,
//         excludeId: bill._id,
//         session,
//       });

//       bill.set(billData);
//       bill.updatedBy = userId;

//       await bill.save({ session });

//       await createAudit({
//         tenantId,
//         userId,
//         action: "UPDATE",
//         bill,
//         oldData,
//         ipAddress,
//         session,
//       });

//       result = bill.toObject();
//     });

//     return result;
//   } catch (error) {
//     throw translateDuplicateError(error);
//   } finally {
//     await session.endSession();
//   }
// };

// const postPurchaseBill = async ({
//   tenantId,
//   userId,
//   billNumber,
//   ipAddress,
// }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const bill = await getDraftForUpdate({
//         tenantId,
//         billNumber,
//         session,
//       });

//       await postBillInTransaction({
//         tenantId,
//         userId,
//         bill,
//         ipAddress,
//         session,
//       });

//       result = bill.toObject();
//     });

//     await notifyBillPosted({
//       tenantId,
//       userId,
//       bill: result,
//     });

//     return result;
//   } catch (error) {
//     throw translateDuplicateError(error);
//   } finally {
//     await session.endSession();
//   }
// };

// const deletePurchaseBill = async ({
//   tenantId,
//   userId,
//   billNumber,
//   ipAddress,
// }) => {
//   const session = await mongoose.startSession();

//   try {
//     let result;

//     await session.withTransaction(async () => {
//       const bill = await getDraftForUpdate({
//         tenantId,
//         billNumber,
//         session,
//       });

//       const oldData = bill.toObject();

//       bill.isDeleted = true;
//       bill.deletedAt = new Date();
//       bill.deletedBy = userId;
//       bill.updatedBy = userId;

//       await bill.save({ session });

//       await createAudit({
//         tenantId,
//         userId,
//         action: "DELETE",
//         bill,
//         oldData,
//         ipAddress,
//         session,
//       });

//       result = bill.toObject();
//     });

//     return result;
//   } finally {
//     await session.endSession();
//   }
// };

// const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const getPurchaseBills = async ({
//   tenantId,
//   search = "",
//   supplierId,
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

//   if (supplierId) {
//     filter.supplierId = supplierId;
//   }

//   if (status) {
//     filter.status = status;
//   }

//   if (paymentStatus) {
//     filter.paymentStatus = paymentStatus;
//   }

//   if (fromDate || toDate) {
//     filter.billDate = {};

//     if (fromDate) {
//       filter.billDate.$gte = new Date(fromDate);
//     }

//     if (toDate) {
//       filter.billDate.$lte = new Date(toDate);
//     }
//   }

//   const searchText = normalizeText(search);

//   if (searchText) {
//     const regex = {
//       $regex: escapeRegex(searchText),
//       $options: "i",
//     };

//     filter.$or = [
//       { billNumber: regex },
//       { supplierName: regex },
//       { supplierCode: regex },
//       { supplierInvoiceNumber: regex },
//     ];
//   }

//   const [data, total] = await Promise.all([
//     PurchaseBill.find(filter)
//       .select("-items")
//       .sort({ billDate: -1, createdAt: -1 })
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

// const getPurchaseBillByNumber = async ({ tenantId, billNumber }) => {
//   const bill = await PurchaseBill.findOne({
//     tenantId,
//     billNumber: normalizeCode(billNumber),
//     isDeleted: false,
//   }).lean();

//   if (!bill) {
//     throw createError("Purchase bill not found", 404);
//   }

//   return bill;
// };

// const getPurchaseBillPayments = async ({
//   tenantId,
//   billNumber,
//   page = 1,
//   limit = 20,
// }) => {
//   const bill = await PurchaseBill.findOne({
//     tenantId,
//     billNumber: normalizeCode(billNumber),
//     isDeleted: false,
//   })
//     .select("_id billNumber")
//     .lean();

//   if (!bill) {
//     throw createError("Purchase bill not found", 404);
//   }

//   const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

//   const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

//   const filter = {
//     tenantId,
//     "allocations.purchaseBillId": bill._id,
//   };

//   const [payments, total] = await Promise.all([
//     SupplierPayment.find(filter)
//       .select(
//         "paymentNumber paymentDate paymentMethod " +
//           "paymentLedgerName referenceNumber status " +
//           "allocations createdAt",
//       )
//       .sort({ paymentDate: -1, createdAt: -1, _id: -1 })
//       .skip((currentPage - 1) * pageLimit)
//       .limit(pageLimit)
//       .lean(),

//     SupplierPayment.countDocuments(filter),
//   ]);

//   const data = payments.map((payment) => {
//     const allocatedAmountPaise = payment.allocations
//       .filter(
//         (allocation) => String(allocation.purchaseBillId) === String(bill._id),
//       )
//       .reduce((sum, allocation) => sum + allocation.amountPaise, 0);

//     return {
//       _id: payment._id,
//       paymentNumber: payment.paymentNumber,
//       paymentDate: payment.paymentDate,
//       paymentMethod: payment.paymentMethod,
//       paymentLedgerName: payment.paymentLedgerName,
//       referenceNumber: payment.referenceNumber,
//       status: payment.status,
//       allocatedAmountPaise,
//     };
//   });

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

// module.exports = {
//   createPurchaseBill,
//   updatePurchaseBill,
//   postPurchaseBill,
//   deletePurchaseBill,
//   getPurchaseBills,
//   getPurchaseBillByNumber,
//   getPurchaseBillPayments,
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

const addAmounts = (first, second) => {
  assertSafeAmount(first);
  assertSafeAmount(second);

  return first + second;
};

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

// const scaledNumber = (
//   value,
//   scale,
//   minimum,
//   maximum,
//   fieldName,
// ) => {
//   if (
//     typeof value !== "number" ||
//     !Number.isFinite(value)
//   ) {
//     throw createError(
//       `${fieldName} must be a valid number`,
//     );
//   }

//   if (
//     value < minimum ||
//     value > maximum
//   ) {
//     throw createError(
//       `${fieldName} must be between ${minimum} and ${maximum}`,
//     );
//   }

//   const scaled = value * scale;
//   const integer = Math.round(scaled);

//   if (
//     !Number.isSafeInteger(integer) ||
//     Math.abs(scaled - integer) > 0.000001
//   ) {
//     throw createError(
//       `${fieldName} has too many decimal places`,
//     );
//   }

//   return integer;
// };
const scaledNumber = ({ value, scale, minimum, maximum, fieldName }) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError(`${fieldName} must be a valid number`);
  }

  if (value < minimum || value > maximum) {
    throw createError(`${fieldName} must be between ${minimum} and ${maximum}`);
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 0.000001) {
    throw createError(`${fieldName} has too many decimal places`);
  }

  return integer;
};
const getPurchaseLedger = async ({ Ledger, tenantId, ledgerId, session }) => {
  const filter = {
    tenantId,
    isActive: true,
    nature: "EXPENSE",
    type: {
      $in: ["ACCOUNT", "SYSTEM"],
    },
  };

  if (ledgerId) {
    filter._id = ledgerId;
  } else {
    filter.code = "PURCHASE";
  }

  const ledger = await Ledger.findOne(filter).session(session).lean();

  if (!ledger) {
    throw createError(
      ledgerId
        ? "The product purchase ledger is missing, inactive, or not an expense ledger"
        : "The active PURCHASE expense ledger is missing. Seed accounting ledgers first.",
      409,
    );
  }

  return ledger;
};

const getSupplier = async ({
  Supplier,
  Ledger,
  tenantId,
  supplierId,
  session,
}) => {
  validateObjectId(supplierId, "supplierId");

  const supplier = await Supplier.findOne({
    _id: supplierId,
    tenantId,
    isDeleted: false,
    status: "Active",
  }).session(session);

  if (!supplier) {
    throw createError("Active supplier not found", 404);
  }

  if (!supplier.ledgerId) {
    throw createError("Supplier does not have a linked ledger", 409);
  }

  const ledger = await Ledger.findOne({
    _id: supplier.ledgerId,
    tenantId,
    type: "SUPPLIER",
    nature: "LIABILITY",
    referenceType: "SUPPLIER",
    referenceId: supplier._id,
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError("The linked supplier ledger is missing or inactive", 409);
  }

  return supplier;
};

const calculateBill = async ({ models, tenantId, payload, session }) => {
  const { Supplier, Product, Ledger } = models;

  const supplier = await getSupplier({
    Supplier,
    Ledger,
    tenantId,
    supplierId: payload.supplierId,
    session,
  });

  const supplierInvoiceNumber = normalizeText(payload.supplierInvoiceNumber);

  if (!supplierInvoiceNumber || supplierInvoiceNumber.length > 100) {
    throw createError("A valid supplier invoice number is required");
  }

  const billDate = new Date(payload.billDate);

  const dueDate = new Date(payload.dueDate);

  if (
    !payload.billDate ||
    !payload.dueDate ||
    Number.isNaN(billDate.getTime()) ||
    Number.isNaN(dueDate.getTime())
  ) {
    throw createError("Valid billDate and dueDate are required");
  }

  if (dueDate < billDate) {
    throw createError("Due date cannot be before bill date");
  }

  if (!["NONE", "INTRASTATE", "INTERSTATE"].includes(payload.taxMode)) {
    throw createError("Invalid taxMode");
  }

  if (
    !Array.isArray(payload.items) ||
    !payload.items.length ||
    payload.items.length > 200
  ) {
    throw createError("A bill requires between 1 and 200 items");
  }

  if (
    payload.updateStock !== undefined &&
    typeof payload.updateStock !== "boolean"
  ) {
    throw createError("updateStock must be a boolean");
  }

  const productIds = payload.items.map((item) => {
    validateObjectId(item.productId, "productId");

    return String(item.productId).toLowerCase();
  });

  if (new Set(productIds).size !== productIds.length) {
    throw createError("A product can appear only once in a bill");
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

  const purchaseLedgerCache = new Map();

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
    const product = productMap.get(String(input.productId).toLowerCase());

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

    if (typeof input.unitRate !== "number" || input.unitRate > 1000000000) {
      throw createError(`Invalid unit rate for ${product.name}`);
    }

    const unitRatePaise = rupeesToPaise(input.unitRate, "Unit rate");

    const gstRate = input.gstRate ?? product.gstRate;

    if (![0, 3, 5, 12, 18, 28].includes(gstRate)) {
      throw createError(`Invalid GST rate for ${product.name}`);
    }

    if (payload.taxMode === "NONE" && gstRate !== 0) {
      throw createError(
        `GST rate must be zero for ${product.name} when taxMode is NONE`,
      );
    }

    const taxCreditEligible = input.taxCreditEligible ?? false;

    if (typeof taxCreditEligible !== "boolean") {
      throw createError("taxCreditEligible must be a boolean");
    }

    if (taxCreditEligible && !supplier.gstNo) {
      throw createError(
        "Supplier GST number is required when claiming input tax credit",
      );
    }

    const cacheKey = product.purchaseLedgerId
      ? String(product.purchaseLedgerId)
      : "DEFAULT_PURCHASE";

    if (!purchaseLedgerCache.has(cacheKey)) {
      const ledger = await getPurchaseLedger({
        Ledger,
        tenantId,
        ledgerId: product.purchaseLedgerId,
        session,
      });

      purchaseLedgerCache.set(cacheKey, ledger);
    }

    const purchaseLedger = purchaseLedgerCache.get(cacheKey);

    const grossAmountPaise = multiplyDivide(unitRatePaise, quantityMilli, 1000);

    const discountAmountPaise = multiplyDivide(
      grossAmountPaise,
      discountBasisPoints,
      10000,
    );

    const taxableAmountPaise = grossAmountPaise - discountAmountPaise;

    const taxAmountPaise = multiplyDivide(taxableAmountPaise, gstRate, 100);

    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    if (payload.taxMode === "INTRASTATE") {
      cgstAmountPaise = Math.floor(taxAmountPaise / 2);

      sgstAmountPaise = taxAmountPaise - cgstAmountPaise;
    } else if (payload.taxMode === "INTERSTATE") {
      igstAmountPaise = taxAmountPaise;
    }

    const totalAmountPaise = addAmounts(taxableAmountPaise, taxAmountPaise);

    const item = {
      productId: product._id,
      productCode: product.productCode,
      productName: product.name,
      productType: product.type,
      trackInventory:
        product.type === "GOODS" ? Boolean(product.trackInventory) : false,
      unit: product.unit,
      hsnSacCode: product.hsnSacCode || null,
      quantity: quantityMilli / 1000,
      unitRatePaise,
      discountPercent: discountBasisPoints / 100,
      gstRate,
      taxCreditEligible,
      purchaseLedgerId: purchaseLedger._id,
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
    supplierId: supplier._id,
    supplierCode: supplier.supplierCode,
    supplierName: supplier.supplierName,
    supplierLedgerId: supplier.ledgerId,
    supplierGstNo: supplier.gstNo || null,
    supplierInvoiceNumber,
    supplierInvoiceNumberNormalized: supplierInvoiceNumber.toUpperCase(),
    billDate,
    dueDate,
    currency: "INR",
    paymentTerms:
      normalizeText(payload.paymentTerms) ||
      supplier.paymentTerms ||
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

const ensureNoDuplicateInvoice = async ({
  PurchaseBill,
  tenantId,
  billData,
  excludeId,
  session,
}) => {
  const filter = {
    tenantId,
    supplierId: billData.supplierId,
    supplierInvoiceNumberNormalized: billData.supplierInvoiceNumberNormalized,
    isDeleted: false,
  };

  if (excludeId) {
    filter._id = {
      $ne: excludeId,
    };
  }

  const existing = await PurchaseBill.findOne(filter)
    .session(session)
    .select("_id")
    .lean();

  if (existing) {
    throw createError(
      "This supplier invoice number already exists for the supplier",
      409,
    );
  }
};

const getDraftForUpdate = async ({
  PurchaseBill,
  tenantId,
  billNumber,
  session,
}) => {
  const bill = await PurchaseBill.findOne({
    tenantId,
    billNumber: normalizeCode(billNumber),
    isDeleted: false,
  }).session(session);

  if (!bill) {
    throw createError("Purchase bill not found", 404);
  }

  if (bill.status !== "DRAFT") {
    throw createError(
      "Only draft purchase bills can be edited, posted, or deleted",
      409,
    );
  }

  return bill;
};

const createAudit = async ({
  AuditLog,
  tenantId,
  userId,
  action,
  bill,
  oldData = null,
  ipAddress,
  session,
}) => {
  await AuditLog.create(
    [
      {
        tenantId,
        userId,
        action,
        module: "PURCHASE_BILL",
        documentId: bill._id,
        oldData,
        newData: bill.toObject(),
        ipAddress,
      },
    ],
    {
      session,
      ordered: true,
    },
  );
};

const getTaxLedger = async ({ Ledger, tenantId, code, session }) => {
  const ledger = await Ledger.findOne({
    tenantId,
    code,
    type: "TAX",
    nature: "ASSET",
    isActive: true,
  })
    .session(session)
    .lean();

  if (!ledger) {
    throw createError(
      `Active ${code} tax ledger is missing. Seed accounting ledgers first.`,
      409,
    );
  }

  return ledger;
};

const buildJournalLines = async ({ models, tenantId, bill, session }) => {
  const { Ledger } = models;

  const expenseAmounts = new Map();

  const recoverableTaxes = {
    INPUT_CGST: 0,
    INPUT_SGST: 0,
    INPUT_IGST: 0,
  };
  for (const item of bill.items) {
    const taxAmount =
      item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise;

    const expenseAmount = item.taxCreditEligible
      ? item.taxableAmountPaise
      : addAmounts(item.taxableAmountPaise, taxAmount);

    const ledgerId = String(item.purchaseLedgerId);

    expenseAmounts.set(
      ledgerId,
      addAmounts(expenseAmounts.get(ledgerId) || 0, expenseAmount),
    );

    if (item.taxCreditEligible) {
      recoverableTaxes.INPUT_CGST = addAmounts(
        recoverableTaxes.INPUT_CGST,
        item.cgstAmountPaise,
      );

      recoverableTaxes.INPUT_SGST = addAmounts(
        recoverableTaxes.INPUT_SGST,
        item.sgstAmountPaise,
      );

      recoverableTaxes.INPUT_IGST = addAmounts(
        recoverableTaxes.INPUT_IGST,
        item.igstAmountPaise,
      );
    }
  }

  const lines = [];

  for (const [ledgerId, amount] of expenseAmounts) {
    if (!amount) {
      continue;
    }

    await getPurchaseLedger({
      Ledger,
      tenantId,
      ledgerId,
      session,
    });

    lines.push({
      ledgerId,
      debitPaise: amount,
      creditPaise: 0,
    });
  }

  for (const [code, amount] of Object.entries(recoverableTaxes)) {
    if (!amount) {
      continue;
    }

    const ledger = await getTaxLedger({
      Ledger,
      tenantId,
      code,
      session,
    });

    lines.push({
      ledgerId: ledger._id,
      debitPaise: amount,
      creditPaise: 0,
    });
  }

  lines.push({
    ledgerId: bill.supplierLedgerId,
    debitPaise: 0,
    creditPaise: bill.totalAmountPaise,
  });

  return lines;
};

const postBillInTransaction = async ({
  models,
  tenant,
  tenantId,
  userId,
  bill,
  ipAddress,
  session,
}) => {
  const { Supplier, Product, Ledger, PurchaseBill } = models;

  if (bill.status !== "DRAFT" || bill.isDeleted) {
    throw createError("Only an active draft can be posted", 409);
  }

  if (bill.totalAmountPaise <= 0) {
    throw createError("A bill must have a positive total to be posted");
  }

  const oldData = bill.toObject();

  const supplier = await getSupplier({
    Supplier,
    Ledger,
    tenantId,
    supplierId: bill.supplierId,
    session,
  });

  if (String(supplier.ledgerId) !== String(bill.supplierLedgerId)) {
    throw createError(
      "Supplier ledger has changed. Update the draft before posting.",
    );
  }

  const productIds = bill.items.map((item) => item.productId);

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    status: "ACTIVE",
    isDeleted: false,
  })
    .session(session)
    .lean();

  if (products.length !== productIds.length) {
    throw createError("One or more bill products are no longer active");
  }

  const productMap = new Map(
    products.map((product) => [String(product._id), product]),
  );

  for (const item of bill.items) {
    const product = productMap.get(String(item.productId));

    const tracksStock =
      product.type === "GOODS" ? Boolean(product.trackInventory) : false;

    if (
      product.type !== item.productType ||
      tracksStock !== item.trackInventory ||
      product.unit !== item.unit
    ) {
      throw createError(
        `Product settings changed for ${item.productName}. Update the draft before posting.`,
      );
    }
  }

  const lines = await buildJournalLines({
    models,
    tenantId,
    bill,
    session,
  });

  const journal = await postJournal({
    tenant,
    connection: models.connection,
    userId,
    postingDate: bill.billDate,
    sourceType: "PURCHASE_BILL",
    sourceId: bill._id,
    sourceNumber: bill.billNumber,
    narration: `Purchase bill ${bill.billNumber} - ${bill.supplierName}`,
    lines,
    session,
  });

  if (bill.updateStock) {
    for (const item of bill.items) {
      if (!item.trackInventory) {
        continue;
      }

      const quantityMilli = Math.round(item.quantity * 1000);

      const stockValuePaise = item.taxCreditEligible
        ? item.taxableAmountPaise
        : item.totalAmountPaise;

      const stockUnitRatePaise = multiplyDivide(
        stockValuePaise,
        1000,
        quantityMilli,
      );

      await stockMovementService.createStockMovement({
        tenant,
        connection: models.connection,
        userId,
        productId: item.productId,
        movementType: "PURCHASE",
        quantity: item.quantity,
        unitRate: paiseToRupees(stockUnitRatePaise),
        referenceType: "PURCHASE_BILL",
        referenceId: bill._id,
        referenceNumber: bill.billNumber,
        movementDate: bill.billDate,
        notes: `Purchase bill ${bill.billNumber}`,
        session,
      });
    }
  }

  const supplierLedger = await Ledger.findOne({
    _id: bill.supplierLedgerId,
    tenantId,
  })
    .session(session)
    .lean();

  if (!supplierLedger) {
    throw createError("Supplier ledger was not found after posting", 409);
  }

  supplier.payableBalance =
    supplierLedger.currentBalanceType === "CREDIT"
      ? supplierLedger.currentBalance
      : 0;

  await supplier.save({ session });

  bill.status = "POSTED";
  bill.journalId = journal._id;
  bill.postedAt = new Date();
  bill.postedBy = userId;
  bill.updatedBy = userId;

  await bill.save({ session });

  await createAudit({
    AuditLog: models.AuditLog,
    tenantId,
    userId,
    action: "POST",
    bill,
    oldData,
    ipAddress,
    session,
  });

  return bill;
};

const notifyBillPosted = async ({ tenantId, userId, bill }) => {
  try {
    await NotificationService.create({
      tenantId,
      userId,
      type: "PURCHASE_BILL",
      title: "Purchase bill posted",
      message: `${bill.billNumber} for ${bill.supplierName} was posted successfully.`,
      icon: "purchase-order",
      priority: "NORMAL",
      route: "purchaseinvoices",
      data: {
        purchaseBillId: bill._id.toString(),
        billNumber: bill.billNumber,
        supplierId: bill.supplierId.toString(),
        totalAmountPaise: bill.totalAmountPaise,
      },
    });
  } catch (error) {
    console.error(
      "Purchase bill notification failed:",
      error?.message || error,
    );
  }
};

const translateDuplicateError = (error) => {
  if (error?.code === 11000) {
    return createError(
      "Purchase bill number or supplier invoice number already exists",
      409,
    );
  }

  return error;
};

const createPurchaseBill = async ({ tenant, userId, payload, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  models.connection = connection;

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const billData = await calculateBill({
        models,
        tenantId,
        payload,
        session,
      });

      await ensureNoDuplicateInvoice({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billData,
        session,
      });

      // const billNumber = await getNextSequence("PB", tenantId.toString());
      const billNumber = await getNextSequence("PB", tenantId.toString(), 3, {
        connection,
        session,
      });

      const records = await models.PurchaseBill.create(
        [
          {
            ...billData,
            tenantId,
            billNumber,
            status: "DRAFT",
            createdBy: userId,
            updatedBy: userId,
          },
        ],
        {
          session,
          ordered: true,
        },
      );

      const bill = records[0];

      await createAudit({
        AuditLog: models.AuditLog,
        tenantId,
        userId,
        action: "CREATE",
        bill,
        ipAddress,
        session,
      });

      if (payload.action === "SAVEANDPOST") {
        await postBillInTransaction({
          models,
          tenant,
          tenantId,
          userId,
          bill,
          ipAddress,
          session,
        });
      }

      result = bill.toObject();

      if (result.status === "POSTED") {
        notifyBillPosted({
          tenantId,
          userId,
          bill: result,
        });
      }
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const updatePurchaseBill = async ({
  tenant,
  userId,
  billNumber,
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
      const bill = await getDraftForUpdate({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billNumber,
        session,
      });

      const oldData = bill.toObject();

      const billData = await calculateBill({
        models,
        tenantId,
        payload,
        session,
      });

      await ensureNoDuplicateInvoice({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billData,
        excludeId: bill._id,
        session,
      });

      bill.set(billData);
      bill.updatedBy = userId;

      await bill.save({ session });

      await createAudit({
        AuditLog: models.AuditLog,
        tenantId,
        userId,
        action: "UPDATE",
        bill,
        oldData,
        ipAddress,
        session,
      });

      result = bill.toObject();
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const postPurchaseBill = async ({ tenant, userId, billNumber, ipAddress }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  models.connection = connection;

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const bill = await getDraftForUpdate({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billNumber,
        session,
      });

      await postBillInTransaction({
        models,
        tenant,
        tenantId,
        userId,
        bill,
        ipAddress,
        session,
      });

      result = bill.toObject();

      notifyBillPosted({
        tenantId,
        userId,
        bill: result,
      });
    });

    return result;
  } catch (error) {
    throw translateDuplicateError(error);
  } finally {
    await session.endSession();
  }
};

const deletePurchaseBill = async ({
  tenant,
  userId,
  billNumber,
  ipAddress,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const session = await connection.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const bill = await getDraftForUpdate({
        PurchaseBill: models.PurchaseBill,
        tenantId,
        billNumber,
        session,
      });

      const oldData = bill.toObject();

      bill.isDeleted = true;
      bill.deletedAt = new Date();
      bill.deletedBy = userId;
      bill.updatedBy = userId;

      await bill.save({ session });

      await createAudit({
        AuditLog: models.AuditLog,
        tenantId,
        userId,
        action: "DELETE",
        bill,
        oldData,
        ipAddress,
        session,
      });

      result = bill.toObject();
    });

    return result;
  } finally {
    await session.endSession();
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPurchaseBills = async ({
  tenant,
  search = "",
  supplierId,
  status,
  paymentStatus,
  fromDate,
  toDate,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (supplierId) {
    filter.supplierId = supplierId;
  }

  if (status) {
    filter.status = status;
  }

  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }

  if (fromDate || toDate) {
    filter.billDate = {};

    if (fromDate) {
      filter.billDate.$gte = new Date(fromDate);
    }

    if (toDate) {
      filter.billDate.$lte = new Date(toDate);
    }
  }

  const searchText = normalizeText(search);

  if (searchText) {
    const regex = {
      $regex: escapeRegex(searchText),
      $options: "i",
    };

    filter.$or = [
      { billNumber: regex },
      { supplierName: regex },
      { supplierCode: regex },
      {
        supplierInvoiceNumber: regex,
      },
    ];
  }

  const [data, total] = await Promise.all([
    models.PurchaseBill.find(filter)
      .select("-items")
      .sort({
        billDate: -1,
        createdAt: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    models.PurchaseBill.countDocuments(filter),
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

const getPurchaseBillByNumber = async ({ tenant, billNumber }) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const bill = await models.PurchaseBill.findOne({
    tenantId: tenant._id,
    billNumber: normalizeCode(billNumber),
    isDeleted: false,
  }).lean();

  if (!bill) {
    throw createError("Purchase bill not found", 404);
  }

  return bill;
};

const getPurchaseBillPayments = async ({
  tenant,
  billNumber,
  page = 1,
  limit = 20,
}) => {
  const connection = getReadyTenantConnection(tenant);

  const models = getTenantAccountingModels(connection);

  const tenantId = tenant._id;

  const bill = await models.PurchaseBill.findOne({
    tenantId,
    billNumber: normalizeCode(billNumber),
    isDeleted: false,
  })
    .select("_id billNumber")
    .lean();

  if (!bill) {
    throw createError("Purchase bill not found", 404);
  }

  const currentPage = Math.max(Math.floor(Number(page) || 1), 1);

  const pageLimit = Math.min(Math.max(Math.floor(Number(limit) || 20), 1), 100);

  const filter = {
    tenantId,
    "allocations.purchaseBillId": bill._id,
  };

  const [payments, total] = await Promise.all([
    models.SupplierPayment.find(filter)
      .select(
        "paymentNumber paymentDate paymentMethod paymentLedgerName referenceNumber status allocations createdAt",
      )
      .sort({
        paymentDate: -1,
        createdAt: -1,
        _id: -1,
      })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),
    models.SupplierPayment.countDocuments(filter),
  ]);

  const data = payments.map((payment) => {
    const allocatedAmountPaise = payment.allocations
      .filter(
        (allocation) => String(allocation.purchaseBillId) === String(bill._id),
      )
      .reduce((sum, allocation) => sum + allocation.amountPaise, 0);

    return {
      _id: payment._id,
      paymentNumber: payment.paymentNumber,
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      paymentLedgerName: payment.paymentLedgerName,
      referenceNumber: payment.referenceNumber,
      status: payment.status,
      allocatedAmountPaise,
    };
  });

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

module.exports = {
  createPurchaseBill,
  updatePurchaseBill,
  postPurchaseBill,
  deletePurchaseBill,
  getPurchaseBills,
  getPurchaseBillByNumber,
  getPurchaseBillPayments,
};
