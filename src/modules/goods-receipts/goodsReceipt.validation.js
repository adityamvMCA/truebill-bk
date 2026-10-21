const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/);

const versionValue = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict();

const optionalText = (max) => Joi.string().trim().max(max).allow(null, "");

const quantity = Joi.number()
  .min(0.001)
  .max(1000000)
  .precision(3)
  .strict()
  .required();

const directItem = Joi.object({
  productId: objectId.required(),
  quantity,

  estimatedUnitRatePaise: Joi.number()
    .integer()
    .min(0)
    .max(100000000000)
    .strict()
    .required(),

  notes: optionalText(500),
}).unknown(false);

const orderItem = Joi.object({
  orderLineId: objectId.required(),
  quantity,
  notes: optionalText(500),
}).unknown(false);

const createSchema = Joi.object({
  requestId: Joi.string().trim().min(8).max(100).required(),

  creationMode: Joi.string().valid("DIRECT", "PURCHASE_ORDER").required(),

  receiptDate: Joi.string().trim().isoDate().required(),

  supplierId: Joi.when("creationMode", {
    is: "DIRECT",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  sourceOrderId: Joi.when("creationMode", {
    is: "PURCHASE_ORDER",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  sourceOrderVersion: Joi.when("creationMode", {
    is: "PURCHASE_ORDER",
    then: versionValue.required(),
    otherwise: Joi.forbidden(),
  }),

  supplierDeliveryReference: optionalText(100),

  items: Joi.when("creationMode", {
    is: "DIRECT",

    then: Joi.array()
      .items(directItem)
      .min(1)
      .max(200)
      .unique((a, b) => a.productId.toLowerCase() === b.productId.toLowerCase())
      .required(),

    otherwise: Joi.array()
      .items(orderItem)
      .min(1)
      .max(200)
      .unique(
        (a, b) => a.orderLineId.toLowerCase() === b.orderLineId.toLowerCase(),
      )
      .required(),
  }),

  notes: optionalText(2000),
}).unknown(false);

const paramsSchema = Joi.object({
  receiptNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  supplierId: objectId,
  sourceOrderId: objectId,
  creationMode: Joi.string().valid("DIRECT", "PURCHASE_ORDER"),
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
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
};
