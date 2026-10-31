const Joi = require("joi");

const name = Joi.string().trim().min(1).max(100);

const description = Joi.string()
  .trim()
  .max(1000)
  .allow(null, "");

const status = Joi.string().valid("ACTIVE", "INACTIVE");

const createProductBrandSchema = Joi.object({
  name: name.required(),
  description,
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
  description,
  status,
})
  .or("name", "description", "status")
  .unknown(false);

const paramsSchema = Joi.object({
  brandId: Joi.string()
    .trim()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({
      "string.pattern.base": "A valid brand ID is required",
    }),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),
  status,
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string()
    .valid("name", "brandCode", "status", "createdAt", "updatedAt")
    .default("createdAt"),
  sortOrder: Joi.string().valid("asc", "desc").default("desc"),
}).unknown(false);

const bulkStatusSchema = Joi.object({
  brandIds: Joi.array()
    .items(
      Joi.string()
        .trim()
        .pattern(/^[a-f\d]{24}$/i)
        .required(),
    )
    .min(1)
    .max(500)
    .unique()
    .required(),

  status: status.required(),

  versions: Joi.object()
    .pattern(
      /^[a-f\d]{24}$/i,
      Joi.number()
        .integer()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .strict()
        .required(),
    )
    .required(),
}).unknown(false);

const seedSchema = Joi.object({
  confirm: Joi.boolean().valid(true).strict().required(),
}).unknown(false);

const validate = (schema, source = "body") => (req, res, next) => {
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
  createSchema: createProductBrandSchema,
  createProductBrandSchema,
  validateCreate: validate(createProductBrandSchema),
  validateUpdate: validate(updateSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  validateBulkStatus: validate(bulkStatusSchema),
  validateSeed: validate(seedSchema),
};