const Joi = require("joi");

const name = Joi.string().trim().min(1).max(100);

const optionalText = (maximum) =>
  Joi.string().trim().max(maximum).allow(null, "");

const rate = Joi.number().min(0).max(100).strict();

const taxType = Joi.string().valid("GST", "VAT", "CUSTOM");

const status = Joi.string().valid("ACTIVE", "INACTIVE");

const createSchema = Joi.object({
  name: name.required(),
  rate: rate.required(),
  taxType: taxType.default("GST"),
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
  description: optionalText(1000),
  status,
})
  .or("name", "description", "status")
  .unknown(false);

const paramsSchema = Joi.object({
  taxRateId: Joi.string()
    .trim()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      "string.pattern.base": "A valid tax rate ID is required",
    }),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  status,
  taxType,
  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().valid(20, 50, 100).default(20),

  sortBy: Joi.string()
    .valid("name", "rate", "taxType", "status", "createdAt", "updatedAt")
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

  status: status.required(),
}).unknown(false);

const createTaxRateSchema = Joi.object({
  name: name.required(),
  rate: rate.required(),
  taxType: taxType.default("GST"),
  description: optionalText(1000),
  status: status.default("ACTIVE"),
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
  createTaxRateSchema,
};
