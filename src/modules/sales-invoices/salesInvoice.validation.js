const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid ObjectId",
  });

const money = Joi.number().min(0).max(1000000000).precision(2).strict();

const optionalText = Joi.string().trim().max(1000).allow("", null);

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

  gstRate: Joi.number().valid(0, 3, 5, 12, 18, 28).strict(),
}).unknown(false);

const editableFields = {
  customerId: objectId.required(),

  invoiceDate: Joi.date().iso().required(),

  dueDate: Joi.date().iso().min(Joi.ref("invoiceDate")).required().messages({
    "date.min": "Due date cannot be before invoice date",
  }),

  paymentTerms: Joi.string().trim().max(100).default("Due on Receipt"),

  taxMode: Joi.string().valid("NONE", "INTRA_STATE", "INTER_STATE").required(),

  updateStock: Joi.boolean().strict().default(false),

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
      "array.unique": "A product can appear only once in a sales invoice",
    }),

  notes: optionalText,
};

const createSalesInvoiceSchema = Joi.object({
  ...editableFields,

  action: Joi.string()
    .valid("SAVE_CREATED", "SAVE_AND_POST")
    .default("SAVE_CREATED"),
}).unknown(false);

const updateSalesInvoiceSchema = Joi.object({
  ...editableFields,
}).unknown(false);

const postSalesInvoiceSchema = Joi.object({}).unknown(false);

const invoiceParamsSchema = Joi.object({
  invoiceNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listSalesInvoicesSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  customerId: objectId,

  status: Joi.string().valid("CREATED", "POSTED", "CANCELLED"),

  paymentStatus: Joi.string().valid("UNPAID", "PARTIALLY_PAID", "PAID"),

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
  validateCreateSalesInvoice: validate(createSalesInvoiceSchema),
  validateUpdateSalesInvoice: validate(updateSalesInvoiceSchema),
  validatePostSalesInvoice: validate(postSalesInvoiceSchema),
  validateSalesInvoiceParams: validate(invoiceParamsSchema, "params"),
  validateListSalesInvoices: validate(listSalesInvoicesSchema, "query"),
};
