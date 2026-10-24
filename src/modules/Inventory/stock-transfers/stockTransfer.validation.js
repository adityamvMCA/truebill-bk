const Joi = require("joi");
const id = Joi.string().trim().pattern(/^[a-f\d]{24}$/i);
const createSchema = Joi.object({
  requestId: Joi.string().guid({ version: "uuidv4" }).lowercase().required(),
  transferDate: Joi.date().iso().max("now").required(),
  fromWarehouseId: id.required(),
  toWarehouseId: id.required(),
  items: Joi.array().items(Joi.object({
    productId: id.required(),
    quantity: Joi.number().min(0.001).max(1000000).precision(3).strict().required(),
  }).unknown(false)).min(1).max(100).unique((a, b) => a.productId.toLowerCase() === b.productId.toLowerCase()).required(),
  notes: Joi.string().trim().max(500).allow(null, ""),
}).unknown(false);
const paramsSchema = Joi.object({ transferNumber: Joi.string().trim().uppercase().max(100).required() }).unknown(false);
const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),
  fromWarehouseId: id,
  toWarehouseId: id,
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
const enableSchema = Joi.object({ confirm: Joi.boolean().valid(true).strict().required() }).unknown(false);
const validate = (schema, source = "body") => (req, res, next) => {
  const { error, value } = schema.validate(req[source] ?? {}, { abortEarly: false, convert: true });
  if (error) return res.status(400).json({ success: false, message: "Validation failed", errors: error.details.map((item) => item.message) });
  req[{ body: "validatedBody", params: "validatedParams", query: "validatedQuery" }[source]] = value;
  return next();
};
module.exports = {
  validateCreate: validate(createSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  validateEnable: validate(enableSchema),
};
