const Joi = require("joi");

const objectId = Joi.string().trim().pattern(/^[a-fA-F0-9]{24}$/).messages({
  "string.pattern.base": "must be a valid ObjectId",
});

const registerSchema = Joi.object({
  productId: objectId.required(),
  barcode: Joi.string().trim().min(1).max(64).required(),
  source: Joi.string().valid("MANUFACTURER", "SUPPLIER", "INTERNAL", "GS1_ASSIGNED").required(),
  barcodeType: Joi.string().valid("EAN13", "EAN8", "UPC_A", "CODE128", "ITF14", "QR"),
  packagingName: Joi.string().trim().max(60).default("Unit"),
  conversionQuantity: Joi.number().min(0.001).max(1000000).default(1),
  unit: Joi.string().trim().uppercase().max(20).allow("", null),
  isPrimary: Joi.boolean().default(false),
}).unknown(false);

const internalSchema = Joi.object({
  packagingName: Joi.string().trim().max(60).default("Unit"),
  conversionQuantity: Joi.number().min(0.001).max(1000000).default(1),
  isPrimary: Joi.boolean().default(false),
}).unknown(false);

const sessionSchema = Joi.object({
  documentType: Joi.string().valid("PURCHASE", "SALES", "STOCK_IN", "STOCK_OUT", "INVENTORY").required(),
  documentId: objectId.allow(null),
}).unknown(false);

const syncSchema = Joi.object({
  scans: Joi.array().min(1).max(200).items(
    Joi.object({
      scanId: Joi.string().trim().max(64).required(),
      barcode: Joi.string().trim().max(64).required(),
      quantity: Joi.number().invalid(0).min(-1000000).max(1000000).required(),
    }).unknown(false),
  ).required(),
}).unknown(false);

const labelsSchema = Joi.object({
  productIds: Joi.array().min(1).max(500).items(objectId.required()).required(),
}).unknown(false);

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body ?? {}, { abortEarly: false, convert: true });
  if (error) {
    return res.status(400).json({
      success: false, message: "Validation failed",
      errors: error.details.map((d) => d.message),
    });
  }
  req.body = value;
  return next();
};

module.exports = {
  validateRegister: validate(registerSchema),
  validateInternal: validate(internalSchema),
  validateSession: validate(sessionSchema),
  validateSync: validate(syncSchema),
  validateLabels: validate(labelsSchema),
};