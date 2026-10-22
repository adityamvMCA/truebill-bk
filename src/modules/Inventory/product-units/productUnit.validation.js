const Joi = require("joi");

const unitCode = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z][A-Z0-9_]{0,19}$/)
  .messages({
    "string.pattern.base":
      "Unit code must start with a letter and contain up to 20 letters, numbers, or underscores",
  });

const name = Joi.string().trim().min(1).max(100);

const optionalText = (maximum) =>
  Joi.string().trim().max(maximum).allow(null, "");

const status = Joi.string().valid("ACTIVE", "INACTIVE");

const createSchema = Joi.object({
  unitCode: unitCode.required(),
  name: name.required(),
  symbol: optionalText(20),
  description: optionalText(1000),
  status: status.default("ACTIVE"),
}).unknown(false);

const updateSchema = Joi.object({
  version: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .strict()
    .required(),

  name,
  symbol: optionalText(20),
  description: optionalText(1000),
  status,
})
  .or("name", "symbol", "description", "status")
  .unknown(false);

const paramsSchema = Joi.object({
  unitCode: unitCode.required(),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  status,

  page: Joi.number().integer().min(1).max(100000).strict().default(1),

  limit: Joi.number().integer().min(1).max(100).strict().default(20),
}).unknown(false);

const validate =
  (schema, source = "body") =>
  (req, res, next) => {
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

    const targets = {
      body: "validatedBody",
      params: "validatedParams",
      query: "validatedQuery",
    };

    req[targets[source]] = value;

    return next();
  };
const createProductUnitSchema = Joi.object({
  unitCode: unitCode.required(),
  name: name.required(),
  symbol: optionalText(20),
  description: optionalText(1000),
  status: status.default("ACTIVE"),
}).unknown(false);

module.exports = {
  validateCreate: validate(createSchema),

  validateUpdate: validate(updateSchema),

  validateParams: validate(paramsSchema, "params"),

  validateList: validate(listSchema, "query"),
  createProductUnitSchema,
};
