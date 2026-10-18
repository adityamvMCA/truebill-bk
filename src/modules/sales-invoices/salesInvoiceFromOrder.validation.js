const Joi = require("joi");

const dateOnly = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return helpers.error("any.invalid");
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return helpers.error("any.invalid");
    }

    return value;
  })
  .messages({
    "string.pattern.base": "{{#label}} must use YYYY-MM-DD format",

    "any.invalid": "{{#label}} must be a valid calendar date",
  });

const paramsSchema = Joi.object({
  orderNumber: Joi.string().trim().uppercase().min(1).max(100).required(),
}).unknown(false);

const bodySchema = Joi.object({
  version: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .strict()
    .required(),

  invoiceDate: dateOnly.required(),

  dueDate: dateOnly.required(),
})
  .unknown(false)
  .custom((value, helpers) => {
    if (value.dueDate < value.invoiceDate) {
      return helpers.message({
        custom: "Due date cannot be before invoice date",
      });
    }

    return value;
  });

const validate = (schema, source) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source] ?? {}, {
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

    if (source === "params") {
      req.validatedParams = value;
    } else {
      req.validatedBody = value;
    }

    return next();
  };
};

module.exports = {
  validateInvoiceOrderParams: validate(paramsSchema, "params"),

  validateInvoiceOrderBody: validate(bodySchema, "body"),
};
