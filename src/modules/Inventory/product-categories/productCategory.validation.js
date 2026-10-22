const Joi = require("joi");

const versionValue = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict()
  .required();

const descriptionValue = Joi.string().trim().max(1000).allow(null, "");

const statusValue = Joi.string().valid("ACTIVE", "INACTIVE");

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),

  description: descriptionValue,

  status: statusValue.default("ACTIVE"),
}).unknown(false);

const updateSchema = Joi.object({
  version: versionValue,
  description: descriptionValue,
  status: statusValue,
})
  .or("description", "status")
  .unknown(false);

const paramsSchema = Joi.object({
  categoryCode: Joi.string().trim().uppercase().min(1).max(100).required(),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  status: statusValue,

  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
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
const createProductCategorySchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),

  description: Joi.string().trim().max(1000).allow(null, ""),

  status: statusValue.default("ACTIVE"),
}).unknown(false);
module.exports = {
  validateCreate: validate(createSchema),
  validateUpdate: validate(updateSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  createProductCategorySchema,
};
