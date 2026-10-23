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

const supplierIds = Joi.array()
  .items(objectId.required())
  .min(1)
  .max(100)
  .unique((first, second) => first.toLowerCase() === second.toLowerCase());

const itemSchema = Joi.object({
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

const itemsSchema = Joi.array().items(itemSchema).min(1).max(200);

const editableFields = {
  rfqDate: dateValue,
  quotationDueDate: dateValue,
  supplierIds,
  deliveryAddress: optionalText(2000),
  paymentTerms: optionalText(100),
  deliveryTerms: optionalText(1000),
  termsAndConditions: optionalText(5000),
  notes: optionalText(2000),
};

/* ==========================================
   CREATE
   ========================================== */

const createSchema = Joi.object({
  ...editableFields,

  creationMode: Joi.string().valid("DIRECT", "REQUISITION").required(),

  rfqDate: dateValue.required(),

  quotationDueDate: dateValue.required(),

  supplierIds: supplierIds.required(),

  sourceRequisitionId: Joi.when("creationMode", {
    is: "REQUISITION",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  sourceRequisitionVersion: Joi.when("creationMode", {
    is: "REQUISITION",
    then: versionValue.required(),
    otherwise: Joi.forbidden(),
  }),

  items: Joi.when("creationMode", {
    is: "DIRECT",
    then: itemsSchema.required(),
    otherwise: Joi.forbidden(),
  }),
}).unknown(false);

/* ==========================================
   UPDATE

   The service permits item changes only
   for DIRECT RFQs.
   ========================================== */

const updateSchema = Joi.object({
  ...editableFields,

  version: versionValue.required(),

  items: itemsSchema,
})
  .or(...Object.keys(editableFields), "items")
  .unknown(false);

/* ==========================================
   PARAMS / LIST / STATUS
   ========================================== */

const paramsSchema = Joi.object({
  rfqNumber: Joi.string().trim().uppercase().max(100).required(),
}).unknown(false);

const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100000).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),

  search: Joi.string().trim().max(100).allow(""),

  creationMode: Joi.string().valid("DIRECT", "REQUISITION"),

  status: Joi.string().valid(
    "CREATED",
    "APPROVED",
    "REJECTED",
    "ISSUED",
    "CLOSED",
    "CANCELLED",
  ),

  supplierId: objectId,

  sourceRequisitionId: objectId,
}).unknown(false);

const versionSchema = Joi.object({
  version: versionValue.required(),
}).unknown(false);

const cancelSchema = Joi.object({
  version: versionValue.required(),

  cancellationReason: Joi.string().trim().min(1).max(1000).required(),
}).unknown(false);

const rejectSchema = Joi.object({
  version: versionValue.required(),

  rejectionReason: Joi.string()
    .trim()
    .min(1)
    .max(1000)
    .required(),
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

module.exports = {
  validateCreate: validate(createSchema),
  validateUpdate: validate(updateSchema),
  validateParams: validate(paramsSchema, "params"),
  validateList: validate(listSchema, "query"),
  validateVersion: validate(versionSchema),
  validateCancel: validate(cancelSchema),
  validateReject: validate(rejectSchema),
};