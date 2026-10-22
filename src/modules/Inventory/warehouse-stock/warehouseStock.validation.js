const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid ObjectId",
  });

const productCode = Joi.string().trim().uppercase().min(1).max(100);

const pagination = {
  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
};

const listSchema = Joi.object({
  warehouseId: objectId,
  productCode,
  includeZero: Joi.boolean().default(true),
  ...pagination,
}).unknown(false);

const productParamsSchema = Joi.object({
  productCode: productCode.required(),
}).unknown(false);

const productQuerySchema = Joi.object({
  includeZero: Joi.boolean().default(true),
  ...pagination,
}).unknown(false);

const validate = (schema, source) => (req, res, next) => {
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

  const target = source === "params" ? "validatedParams" : "validatedQuery";

  req[target] = value;

  return next();
};

module.exports = {
  validateList: validate(listSchema, "query"),

  validateProductParams: validate(productParamsSchema, "params"),

  validateProductQuery: validate(productQuerySchema, "query"),
};
