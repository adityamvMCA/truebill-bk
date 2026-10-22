const Joi = require("joi");

const code = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z0-9]{2,20}$/)
  .messages({
    "string.pattern.base": "HSN/SAC code must contain 2–20 letters or numbers",
  });

const description = Joi.string().trim().max(500).allow(null, "");

const gstRate = Joi.number().min(0).max(100).strict();

const status = Joi.string().valid("ACTIVE", "INACTIVE");

const createSchema = Joi.object({
  code: code.required(),
  description,
  defaultGstRate: gstRate.default(0),
  status: status.default("ACTIVE"),
}).unknown(false);

const updateSchema = Joi.object({
  version: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .strict()
    .required(),

  description,
  defaultGstRate: gstRate,
  status,
})
  .or("description", "defaultGstRate", "status")
  .unknown(false);

const paramsSchema = Joi.object({
  code: code.required(),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  status,
  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

const createImportSchema = Joi.object({
  code: code.required(),
  description,
  defaultGstRate: gstRate.default(0),
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
  createHsnSacCodeSchema: createImportSchema,
};
