const Joi = require("joi");

const dateOnly = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return helpers.error("date.invalid");
    }

    return value;
  })
  .messages({
    "string.pattern.base": "Date must use YYYY-MM-DD format",
    "date.invalid": "Enter a valid calendar date",
  });

const returnItemSchema = Joi.object({
  invoiceItemIndex: Joi.number().integer().min(0).required(),

  quantity: Joi.number().greater(0).precision(4).required(),
}).unknown(false);

const createSchema = Joi.object({
  invoiceNumber: Joi.string().trim().uppercase().min(1).max(100).required(),

  returnDate: dateOnly.required(),

  updateStock: Joi.boolean().default(false),

  items: Joi.array().items(returnItemSchema).min(1).max(200).required(),

  notes: Joi.string().trim().max(1000).allow("", null).optional(),
}).unknown(false);

const updateSchema = Joi.object({
  returnDate: dateOnly.optional(),

  updateStock: Joi.boolean().optional(),

  items: Joi.array().items(returnItemSchema).min(1).max(200).optional(),

  notes: Joi.string().trim().max(1000).allow("", null).optional(),
})
  .min(1)
  .unknown(false);

const paramsSchema = Joi.object({
  returnNumber: Joi.string().trim().uppercase().min(1).max(100).required(),
});

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),

  search: Joi.string().trim().max(100).allow("").default(""),

  status: Joi.string().valid("CREATED", "POSTED", "CANCELLED").optional(),

  invoiceNumber: Joi.string().trim().uppercase().max(100).optional(),

  customerId: Joi.string().hex().length(24).optional(),

  fromDate: dateOnly.optional(),
  toDate: dateOnly.optional(),
}).unknown(false);

const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const input =
      source === "body"
        ? (req.body ?? {})
        : source === "query"
          ? req.query
          : req.params;

    const { error, value } = schema.validate(input, {
      abortEarly: false,
      convert: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((item) => item.message),
      });
    }

    if (source === "body") req.body = value;
    else if (source === "query") req.validatedQuery = value;
    else req.validatedParams = value;

    return next();
  };
};

module.exports = {
  validateCreateSalesReturn: validate(createSchema),
  validateUpdateSalesReturn: validate(updateSchema),
  validateSalesReturnParams: validate(paramsSchema, "params"),
  validateListSalesReturns: validate(listSchema, "query"),
};
