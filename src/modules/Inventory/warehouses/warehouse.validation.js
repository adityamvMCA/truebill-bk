const Joi = require("joi");

const warehouseCode = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z][A-Z0-9_]{0,19}$/)
  .messages({
    "string.pattern.base":
      "Warehouse code must start with a letter and contain up to 20 letters, numbers, or underscores",
  });

const name = Joi.string().trim().min(1).max(100);

const optionalText = (maximum) =>
  Joi.string().trim().max(maximum).allow(null, "");

const createSchema = Joi.object({

  name: name.required(),

  address: optionalText(2000),

  description: optionalText(1000),
}).unknown(false);

const updateSchema = Joi.object({
  version: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .strict()
    .required(),

  name,

  address: optionalText(2000),

  description: optionalText(1000),
})
  .or("name", "address", "description")
  .unknown(false);

const paramsSchema = Joi.object({
  warehouseCode: warehouseCode.required(),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  status: Joi.string().valid("ACTIVE", "INACTIVE"),

  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().valid(20, 50, 100).default(20),

  sortBy: Joi.string()
    .valid("warehouseCode", "name", "status", "createdAt", "updatedAt")
    .allow(""),

  sortDir: Joi.string().valid("asc", "desc").allow(""),
}).unknown(false);

const bulkStatusSchema = Joi.object({
  ids: Joi.array()
    .items(Joi.string().trim().pattern(/^[a-f\d]{24}$/i))
    .min(1)
    .max(1000)
    .unique()
    .required(),

  status: Joi.string().valid("ACTIVE", "INACTIVE").required(),
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

module.exports = {
  validateCreate: validate(createSchema),
  validateUpdate: validate(updateSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  validateBulkStatus: validate(bulkStatusSchema),
};
