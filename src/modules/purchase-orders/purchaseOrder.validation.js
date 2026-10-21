const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/);

const dateValue = Joi.string().trim().isoDate();

const versionValue = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict();

const optionalText = (max) => Joi.string().trim().max(max).allow(null, "");

const itemSchema = Joi.object({
  lineId: objectId,
  productId: objectId.required(),

  quantity: Joi.number()
    .min(0.001)
    .max(1000000)
    .precision(3)
    .strict()
    .required(),

  unitRatePaise: Joi.number()
    .integer()
    .min(0)
    .max(100000000000)
    .strict()
    .required(),

  discountPercent: Joi.number()
    .min(0)
    .max(100)
    .precision(2)
    .strict()
    .default(0),

  gstRate: Joi.number().valid(0, 3, 5, 12, 18, 28).strict().required(),

  specification: optionalText(1000),
}).unknown(false);

const itemsSchema = Joi.array().items(itemSchema).min(1).max(200);

const taxMode = Joi.string().valid("NONE", "INTRA_STATE", "INTER_STATE");

const commonFields = {
  orderDate: dateValue,
  expectedDeliveryDate: dateValue.allow(null, ""),
  deliveryAddress: optionalText(2000),
  notes: optionalText(2000),
};

const commercialFields = {
  paymentTerms: optionalText(100),
  deliveryTerms: optionalText(1000),
  termsAndConditions: optionalText(5000),
};

const createSchema = Joi.object({
  ...commonFields,

  creationMode: Joi.string().valid("DIRECT", "QUOTATION").required(),

  orderDate: dateValue.required(),

  supplierId: Joi.when("creationMode", {
    is: "DIRECT",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  sourceQuotationId: Joi.when("creationMode", {
    is: "QUOTATION",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  sourceQuotationVersion: Joi.when("creationMode", {
    is: "QUOTATION",
    then: versionValue.required(),
    otherwise: Joi.forbidden(),
  }),

  taxMode: Joi.when("creationMode", {
    is: "DIRECT",
    then: taxMode.required(),
    otherwise: Joi.forbidden(),
  }),

  items: Joi.when("creationMode", {
    is: "DIRECT",
    then: itemsSchema.required(),
    otherwise: Joi.forbidden(),
  }),

  ...Object.fromEntries(
    Object.entries(commercialFields).map(([field, schema]) => [
      field,
      Joi.when("creationMode", {
        is: "DIRECT",
        then: schema,
        otherwise: Joi.forbidden(),
      }),
    ]),
  ),
}).unknown(false);

const updateFields = {
  ...commonFields,
  ...commercialFields,
  taxMode,
  items: itemsSchema,
};

const updateSchema = Joi.object({
  ...updateFields,
  version: versionValue.required(),
})
  .or(...Object.keys(updateFields))
  .unknown(false);

const paramsSchema = Joi.object({
  orderNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),

  search: Joi.string().trim().max(100).allow(""),

  status: Joi.string().valid(
    "CREATED",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "CANCELLED",
  ),

  creationMode: Joi.string().valid("DIRECT", "QUOTATION"),
  supplierId: objectId,
  sourceQuotationId: objectId,
  sourceRfqId: objectId,
}).unknown(false);

const cancelSchema = Joi.object({
  version: versionValue.required(),

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
  validateUpdate: validate(updateSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  validateCancel: validate(cancelSchema),
};
