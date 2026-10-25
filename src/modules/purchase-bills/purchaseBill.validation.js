// const Joi = require("joi");

// const objectId = Joi.string()
//   .trim()
//   .pattern(/^[a-fA-F0-9]{24}$/)
//   .messages({
//     "string.pattern.base": "{{#label}} must be a valid ObjectId",
//   });

// const money = Joi.number().min(0).max(1000000000).precision(2).strict();

// const purchaseBillPaymentsQuerySchema = Joi.object({
//   page: Joi.number().integer().min(1).default(1),

//   limit: Joi.number().integer().min(1).max(100).default(20),
// }).unknown(false);
// const optionalText = (maxLength) =>
//   Joi.string().trim().max(maxLength).allow("", null);

// const itemSchema = Joi.object({
//   productId: objectId.required(),

//   quantity: Joi.number()
//     .min(0.001)
//     .max(1000000)
//     .precision(3)
//     .strict()
//     .required(),

//   unitRate: money.required(),

//   discountPercent: Joi.number()
//     .min(0)
//     .max(100)
//     .precision(2)
//     .strict()
//     .default(0),

//   // Omission uses the product's GST rate in the service.
//   gstRate: Joi.number().valid(0, 3, 5, 12, 18, 28).strict(),

//   // Explicit choice; the service will not assume recoverable GST.
//   taxCreditEligible: Joi.boolean().strict().default(false),
// }).unknown(false);

// const editableFields = {
//   supplierId: objectId.required(),
//   sourceGoodsReceiptId: objectId,
//   supplierInvoiceNumber: Joi.string().trim().max(100).required(),

//   billDate: Joi.date().iso().required(),

//   dueDate: Joi.date().iso().min(Joi.ref("billDate")).required().messages({
//     "date.min": "Due date cannot be before bill date",
//   }),

//   paymentTerms: Joi.string().trim().max(100).default("Due on Receipt"),

//   // taxMode: Joi.string().valid("NONE", "INTRA_STATE", "INTER_STATE").required(),
//   taxMode: Joi.string()
//     .valid("NONE", "INTRASTATE", "INTERSTATE", "INTRA_STATE", "INTER_STATE")
//     .required()
//     .custom((value) => value.replace(/_/g, "")),

//   updateStock: Joi.boolean().strict().default(false),

//   // Duplicate products are rejected to match your StockMovement
//   // unique index: one PURCHASE movement per product per bill.
//   items: Joi.array()
//     .items(itemSchema)
//     .min(1)
//     .max(200)
//     .unique(
//       (first, second) =>
//         first.productId.toLowerCase() === second.productId.toLowerCase(),
//     )
//     .required()
//     .messages({
//       "array.unique": "A product can appear only once in a purchase bill",
//     }),

//   notes: optionalText(1000),
// };

// const createPurchaseBillSchema = Joi.object({
//   ...editableFields,

//   // Optional for compatibility with existing clients.
//   // The service always posts new bills.
//   action: Joi.string()
//     .valid("SAVE_AND_POST", "SAVEANDPOST")
//     .default("SAVE_AND_POST"),
// }).unknown(false);

// // Full draft replacement, not a partial PATCH.
// // Send all required editable fields when updating.
// const updatePurchaseBillSchema = Joi.object({
//   ...editableFields,
// }).unknown(false);

// const postPurchaseBillSchema = Joi.object({}).unknown(false);

// const billParamsSchema = Joi.object({
//   billNumber: Joi.string().trim().uppercase().max(100).required(),
// }).unknown(false);

// const listPurchaseBillsSchema = Joi.object({
//   search: Joi.string().trim().max(100).allow("").default(""),

//   supplierId: objectId,

//   // status: Joi.string().valid("DRAFT", "POSTED", "CANCELLED"),
//   status: Joi.string().valid("CREATED", "POSTED", "CANCELLED", "DRAFT"),

//   paymentStatus: Joi.string().valid("UNPAID", "PARTIALLY_PAID", "PAID"),

//   fromDate: Joi.date().iso(),

//   toDate: Joi.date()
//     .iso()
//     .when("fromDate", {
//       is: Joi.exist(),
//       then: Joi.date().min(Joi.ref("fromDate")),
//     }),

//   page: Joi.number().integer().min(1).default(1),

//   limit: Joi.number().integer().min(1).max(100).default(20),
// }).unknown(false);

// const validate =
//   (schema, source = "body") =>
//   (req, res, next) => {
//     const input = source === "body" ? (req.body ?? {}) : req[source];

//     const { error, value } = schema.validate(input, {
//       abortEarly: false,
//       convert: true,
//     });

//     if (error) {
//       return res.status(400).json({
//         success: false,
//         message: "Validation failed",
//         errors: error.details.map((detail) => detail.message),
//       });
//     }

//     if (source === "body") {
//       req.body = value;
//     } else if (source === "query") {
//       req.validatedQuery = value;
//     } else {
//       req.validatedParams = value;
//     }

//     next();
//   };

// module.exports = {
//   validateCreatePurchaseBill: validate(createPurchaseBillSchema),

//   validateUpdatePurchaseBill: validate(updatePurchaseBillSchema),

//   validatePostPurchaseBill: validate(postPurchaseBillSchema),

//   validatePurchaseBillParams: validate(billParamsSchema, "params"),

//   validateListPurchaseBills: validate(listPurchaseBillsSchema, "query"),
//   validatePurchaseBillPaymentsQuery: validate(
//     purchaseBillPaymentsQuerySchema,
//     "query",
//   ),
// };


const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid ObjectId",
  });

const money = Joi.number()
  .min(0)
  .max(1000000000)
  .precision(2)
  .strict();

const purchaseBillPaymentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

const optionalText = (maxLength) =>
  Joi.string().trim().max(maxLength).allow("", null);

/* ---------- TDS Schema ---------- */

const tdsSchema = Joi.object({
  natureId: objectId.required(),

  deducteeType: Joi.string()
    .valid("COMPANY", "INDIVIDUAL")
    .required(),

  pan: Joi.string()
    .trim()
    .uppercase()
    .allow("", null)
    .optional(),
})
  .allow(null)
  .optional()
  .unknown(false);

/* ---------- Purchase Bill Item Schema ---------- */

const itemSchema = Joi.object({
  productId: objectId.required(),

  quantity: Joi.number()
    .min(0.001)
    .max(1000000)
    .precision(3)
    .strict()
    .required(),

  unitRate: money.required(),

  discountPercent: Joi.number()
    .min(0)
    .max(100)
    .precision(2)
    .strict()
    .default(0),

  // Omission uses the product's GST rate in the service.
  gstRate: Joi.number().valid(0, 3, 5, 12, 18, 28).strict(),

  // Explicit choice; the service will not assume recoverable GST.
  taxCreditEligible: Joi.boolean().strict().default(false),
}).unknown(false);

/* ---------- Editable Purchase Bill Fields ---------- */

const editableFields = {
  supplierId: objectId.required(),

  sourceGoodsReceiptId: objectId,

  supplierInvoiceNumber: Joi.string().trim().max(100).required(),

  billDate: Joi.date().iso().required(),

  dueDate: Joi.date()
    .iso()
    .min(Joi.ref("billDate"))
    .required()
    .messages({
      "date.min": "Due date cannot be before bill date",
    }),

  paymentTerms: Joi.string()
    .trim()
    .max(100)
    .default("Due on Receipt"),

  // Normalize supported tax mode values.
  taxMode: Joi.string()
    .valid("NONE", "INTRASTATE", "INTERSTATE", "INTRA_STATE", "INTER_STATE")
    .required()
    .custom((value) => value.replace(/_/g, "")),

  updateStock: Joi.boolean().strict().default(false),

  // Duplicate products are rejected to match your StockMovement
  // unique index: one PURCHASE movement per product per bill.
  items: Joi.array()
    .items(itemSchema)
    .min(1)
    .max(200)
    .unique(
      (first, second) =>
        first.productId.toLowerCase() === second.productId.toLowerCase(),
    )
    .required()
    .messages({
      "array.unique": "A product can appear only once in a purchase bill",
    }),

  notes: optionalText(1000),

  // Optional TDS details. Null means TDS is disabled.
  tds: tdsSchema,
};

/* ---------- Create Purchase Bill ---------- */

const createPurchaseBillSchema = Joi.object({
  ...editableFields,

  // Optional for compatibility with existing clients.
  // The service always posts new bills.
  action: Joi.string()
    .valid("SAVE_AND_POST", "SAVEANDPOST")
    .default("SAVE_AND_POST"),
}).unknown(false);

/* ---------- Update Purchase Bill ---------- */

// Full draft replacement, not a partial PATCH.
// Send all required editable fields when updating.
const updatePurchaseBillSchema = Joi.object({
  ...editableFields,
}).unknown(false);

/* ---------- Post Purchase Bill ---------- */

const postPurchaseBillSchema = Joi.object({}).unknown(false);

/* ---------- Purchase Bill Route Parameters ---------- */

const billParamsSchema = Joi.object({
  billNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

/* ---------- List Purchase Bills ---------- */

const listPurchaseBillsSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  supplierId: objectId,

  status: Joi.string().valid("CREATED", "POSTED", "CANCELLED", "DRAFT"),

  paymentStatus: Joi.string().valid(
    "UNPAID",
    "PARTIALLY_PAID",
    "PAID",
  ),

  fromDate: Joi.date().iso(),

  toDate: Joi.date()
    .iso()
    .when("fromDate", {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref("fromDate")),
    }),

  page: Joi.number().integer().min(1).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

/* ---------- Validation Middleware ---------- */

const validate =
  (schema, source = "body") =>
  (req, res, next) => {
    const input = source === "body" ? (req.body ?? {}) : req[source];

    const { error, value } = schema.validate(input, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((detail) => detail.message),
      });
    }

    if (source === "body") {
      req.body = value;
    } else if (source === "query") {
      req.validatedQuery = value;
    } else {
      req.validatedParams = value;
    }

    next();
  };

/* ---------- Exports ---------- */

module.exports = {
  validateCreatePurchaseBill: validate(createPurchaseBillSchema),

  validateUpdatePurchaseBill: validate(updatePurchaseBillSchema),

  validatePostPurchaseBill: validate(postPurchaseBillSchema),

  validatePurchaseBillParams: validate(billParamsSchema, "params"),

  validateListPurchaseBills: validate(listPurchaseBillsSchema, "query"),

  validatePurchaseBillPaymentsQuery: validate(
    purchaseBillPaymentsQuerySchema,
    "query",
  ),
};
