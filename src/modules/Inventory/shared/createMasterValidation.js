const Joi = require("joi");

module.exports = (kind) => {
  const name = Joi.string().trim().min(1).max(100);
  const description = Joi.string().trim().max(1000).allow(null, "");
  const status = Joi.string().valid("ACTIVE", "INACTIVE");
  const createSchema = Joi.object({ name: name.required(), description, status: status.default("ACTIVE") }).unknown(false);
  const updateSchema = Joi.object({
    version: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).strict().required(),
    name, description, status,
  }).or("name", "description", "status").unknown(false);
  const paramsSchema = kind === "category"
    ? Joi.object({ categoryCode: Joi.string().trim().uppercase().min(1).max(100).required() }).unknown(false)
    : Joi.object({ brandId: Joi.string().trim().pattern(/^[a-f\d]{24}$/i).required() }).unknown(false);
  const listSchema = Joi.object({
    search: Joi.string().trim().max(100).allow("").default(""),
    status,
    page: Joi.number().integer().min(1).max(100000).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false);
  const seedSchema = Joi.object({ confirm: Joi.boolean().valid(true).strict().required() }).unknown(false);
  const validate = (schema, source = "body") => (req, res, next) => {
    const { error, value } = schema.validate(req[source] ?? {}, { abortEarly: false, convert: true });
    if (error) return res.status(400).json({ success: false, message: "Validation failed", errors: error.details.map((detail) => detail.message) });
    req[{ body: "validatedBody", params: "validatedParams", query: "validatedQuery" }[source]] = value;
    return next();
  };
  return {
    createSchema,
    validateCreate: validate(createSchema),
    validateUpdate: validate(updateSchema),
    validateParams: validate(paramsSchema, "params"),
    validateList: validate(listSchema, "query"),
    validateSeed: validate(seedSchema),
  };
};
