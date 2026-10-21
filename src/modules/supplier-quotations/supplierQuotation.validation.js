const Joi = require("joi");

/* ==========================================
   SHARED VALIDATORS
   ========================================== */

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be a valid ObjectId",
  });

const versionValue = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict()
  .messages({
    "any.required": "{{#label}} is required",

    "number.base": "{{#label}} must be a number",

    "number.integer": "{{#label}} must be an integer",

    "number.min": "{{#label}} cannot be negative",
  });

const dateValue = Joi.string().trim().isoDate();

const optionalText = (max) => Joi.string().trim().max(max).allow(null, "");

/* ==========================================
   ITEMS
   ========================================== */

const itemSchema = Joi.object({
  lineId: objectId,

  // Required for RFQ mode and forbidden for
  // DIRECT mode by createSchema validation below.
  rfqLineId: objectId,

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

/* ==========================================
   EDITABLE FIELDS
   ========================================== */

const editableFields = {
  supplierReferenceNumber: optionalText(100),

  quotationDate: dateValue,

  validUntil: dateValue.allow(null, ""),

  taxMode: Joi.string().valid("NONE", "INTRA_STATE", "INTER_STATE"),

  items: itemsSchema,

  paymentTerms: optionalText(100),

  deliveryTerms: optionalText(1000),

  notes: optionalText(2000),

  termsAndConditions: optionalText(5000),
};

/* ==========================================
   CREATE
   ========================================== */

const createSchema = Joi.object({
  ...editableFields,

  creationMode: Joi.string().valid("DIRECT", "RFQ").required(),

  supplierId: objectId.required(),

  sourceRfqId: Joi.when("creationMode", {
    is: "RFQ",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  sourceRfqVersion: Joi.when("creationMode", {
    is: "RFQ",
    then: versionValue.required(),
    otherwise: Joi.forbidden(),
  }),

  quotationDate: dateValue.required(),

  taxMode: editableFields.taxMode.required(),

  items: itemsSchema.required(),
})
  .unknown(false)
  .custom((value, helpers) => {
    for (const [index, item] of value.items.entries()) {
      if (value.creationMode === "RFQ" && !item.rfqLineId) {
        return helpers.message({
          custom: `Item ${index + 1}: rfqLineId is required for an RFQ quotation`,
        });
      }

      if (value.creationMode === "DIRECT" && item.rfqLineId !== undefined) {
        return helpers.message({
          custom: `Item ${index + 1}: rfqLineId is not allowed for a DIRECT quotation`,
        });
      }
    }

    return value;
  });

/* ==========================================
   UPDATE

   Existing document mode is checked by
   the service, not supplied by the client.
   ========================================== */

const updateSchema = Joi.object({
  ...editableFields,

  version: versionValue.required(),
})
  .or(...Object.keys(editableFields))
  .unknown(false);

/* ==========================================
   PARAMS
   ========================================== */

const paramsSchema = Joi.object({
  quotationNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

/* ==========================================
   LIST
   ========================================== */

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),

  search: Joi.string().trim().max(100).allow(""),

  creationMode: Joi.string().valid("DIRECT", "RFQ"),

  sourceRfqId: objectId,

  supplierId: objectId,

  status: Joi.string().valid("CREATED", "CANCELLED"),
}).unknown(false);

/* ==========================================
   VERSION BODY — USED BY DELETE
   ========================================== */

const versionSchema = Joi.object({
  version: versionValue.required(),
}).unknown(false);

/* ==========================================
   CANCEL
   ========================================== */

const cancelSchema = Joi.object({
  version: versionValue.required(),

  cancellationReason: Joi.string().trim().min(1).max(1000).required(),
}).unknown(false);

/* ==========================================
   VALIDATION MIDDLEWARE
   ========================================== */

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

/* ==========================================
   EXPORTS
   ========================================== */

module.exports = {
  validateCreate: validate(createSchema),

  validateUpdate: validate(updateSchema),

  validateParams: validate(paramsSchema, "params"),

  validateList: validate(listSchema, "query"),

  validateVersion: validate(versionSchema),

  validateCancel: validate(cancelSchema),
};
