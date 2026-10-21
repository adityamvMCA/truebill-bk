const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/);

const createSchema = Joi.object({
  requestId: Joi.string()
    .trim()
    .lowercase()
    .guid({ version: ["uuidv4"] })
    .required(),

  purchaseBillId: objectId.required(),

  billVersion: Joi.number()
    .integer()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .strict()
    .required(),

  returnDate: Joi.string().trim().isoDate().required(),

  reason: Joi.string().trim().min(1).max(1000).required(),

  items: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),

        quantity: Joi.number()
          .min(0.001)
          .max(1000000)
          .precision(3)
          .strict()
          .required(),
      }).unknown(false),
    )
    .min(1)
    .max(200)
    .unique((a, b) => a.productId.toLowerCase() === b.productId.toLowerCase())
    .required(),
}).unknown(false);

const paramsSchema = Joi.object({
  returnNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  purchaseBillId: objectId,
  supplierId: objectId,
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
      query: "validatedQuery",
      params: "validatedParams",
    };

    req[targets[source]] = value;

    return next();
  };

module.exports = {
  validateCreate: validate(createSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
};
