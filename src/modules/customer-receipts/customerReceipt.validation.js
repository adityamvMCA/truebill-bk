const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid ObjectId",
  });

const money = Joi.number().min(0).max(1000000000).precision(2).strict();

const allocationSchema = Joi.object({
  salesInvoiceId: objectId.required(),
  amount: money.required(),
}).unknown(false);

const createCustomerReceiptSchema = Joi.object({
  requestId: Joi.string()
    .trim()
    .uuid({ version: ["uuidv4"] })
    .required(),

  customerId: objectId.required(),

  receiptLedgerId: objectId.required(),

  receiptDate: Joi.date().iso().required(),

  receiptMethod: Joi.string()
    .valid("CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD")
    .required(),

  referenceNumber: Joi.string().trim().max(100).allow("", null),

  amount: money.required(),

  allocations: Joi.array()
    .items(allocationSchema)
    .min(1)
    .max(200)
    .unique(
      (first, second) =>
        first.salesInvoiceId.toLowerCase() ===
        second.salesInvoiceId.toLowerCase(),
    )
    .required()
    .messages({
      "array.unique": "An invoice can appear only once in a receipt",
    }),

  notes: Joi.string().trim().max(1000).allow("", null),
}).unknown(false);

const receiptParamsSchema = Joi.object({
  receiptNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listCustomerReceiptsSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  customerId: objectId,

  receiptMethod: Joi.string().valid(
    "CASH",
    "BANK_TRANSFER",
    "UPI",
    "CHEQUE",
    "CARD",
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

module.exports = {
  validateCreateCustomerReceipt: validate(createCustomerReceiptSchema),
  validateCustomerReceiptParams: validate(receiptParamsSchema, "params"),
  validateListCustomerReceipts: validate(listCustomerReceiptsSchema, "query"),
};
