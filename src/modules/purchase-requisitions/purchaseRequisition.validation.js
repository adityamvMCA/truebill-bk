const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/);

const dateValue = Joi.string().trim().isoDate();

const optionalText = (max) => Joi.string().trim().max(max).allow(null, "");

const version = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict()
  .required();

const item = Joi.object({
  lineId: objectId,
  productId: objectId.required(),

  quantity: Joi.number()
    .min(0.001)
    .max(1000000)
    .precision(3)
    .strict()
    .required(),

  specification: optionalText(1000),
}).unknown(false);

const fields = {
  requisitionDate: dateValue,
  requiredByDate: dateValue.allow(null, ""),
  department: optionalText(100),
  purpose: Joi.string().trim().min(1).max(1000),
  priority: Joi.string().valid("LOW", "NORMAL", "HIGH", "URGENT"),
  items: Joi.array().items(item).min(1).max(200),
  notes: optionalText(2000),
};

const createSchema = Joi.object({
  ...fields,
  requisitionDate: fields.requisitionDate.required(),
  purpose: fields.purpose.required(),
  priority: fields.priority.default("NORMAL"),
  items: fields.items.required(),
}).unknown(false);

const updateSchema = Joi.object({
  ...fields,
  version,
})
  .or(...Object.keys(fields))
  .unknown(false);

const paramsSchema = Joi.object({
  requisitionNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),

  search: Joi.string().trim().max(100).allow(""),

  status: Joi.string().valid("CREATED", "APPROVED", "REJECTED", "CANCELLED"),

  priority: fields.priority,
  createdBy: objectId,
}).unknown(false);

const versionSchema = Joi.object({ version }).unknown(false);

const rejectSchema = Joi.object({
  version,
  rejectionReason: Joi.string().trim().min(1).max(1000).required(),
}).unknown(false);

const cancelSchema = Joi.object({
  version,
  cancellationReason: Joi.string().trim().min(1).max(1000).required(),
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

    const target = {
      body: "validatedBody",
      params: "validatedParams",
      query: "validatedQuery",
    };

    req[target[source]] = value;

    return next();
  };

module.exports = {
  validateCreate: validate(createSchema),
  validateUpdate: validate(updateSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  validateVersion: validate(versionSchema),
  validateReject: validate(rejectSchema),
  validateCancel: validate(cancelSchema),
};
