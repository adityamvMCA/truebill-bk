const Joi = require("joi");

const {
  TRANSPORT_MODES,
  VEHICLE_TYPES,
  CANCEL_REASONS,
  VEHICLE_UPDATE_REASONS,
  EXTEND_REASONS,
  GSTIN_REGEX,
  PINCODE_REGEX,
  STATE_CODE_REGEX,
  EWB_NUMBER_REGEX,
  VEHICLE_REGEX,
  MAX_DISTANCE_KM,
} = require("./ewayBill.rules");

const version = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict()
  .required()
  .messages({ "any.required": "Invoice version is required" });

const optionalText = (max) => Joi.string().trim().max(max).allow("", null);

const instant = Joi.date().iso();

const dateOnly = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "{{#label}} must use YYYY-MM-DD format" });

const vehicleNumber = Joi.string()
  .trim()
  .uppercase()
  .pattern(VEHICLE_REGEX)
  .messages({
    "string.pattern.base":
      "Vehicle number is invalid. Example: MH12AB1234 (no spaces or hyphens)",
  });

const gstin = Joi.string()
  .trim()
  .uppercase()
  .pattern(GSTIN_REGEX)
  .messages({ "string.pattern.base": "{{#label}} must be a valid GSTIN" });

const pincode = Joi.string()
  .trim()
  .pattern(PINCODE_REGEX)
  .messages({ "string.pattern.base": "{{#label}} must be a valid 6-digit pincode" });

const stateCode = Joi.string()
  .trim()
  .pattern(STATE_CODE_REGEX)
  .messages({ "string.pattern.base": "{{#label}} must be a valid GST state code" });

/* Omitted fields stay untouched; "" or null clears them. */
const detailsSchema = Joi.object({
  version,

  distanceKm: Joi.number()
    .integer()
    .min(1)
    .max(MAX_DISTANCE_KM)
    .strict(),

  transportMode: Joi.string().valid(...TRANSPORT_MODES),
  vehicleType: Joi.string().valid(...VEHICLE_TYPES),

  vehicleNumber: vehicleNumber.allow("", null),
  transporterId: gstin.allow("", null),
  transporterName: optionalText(200),
  transportDocNumber: optionalText(100),
  transportDocDate: dateOnly.allow("", null),

  fromPlace: Joi.string().trim().min(1).max(50),
  fromPincode: pincode,
  fromStateCode: stateCode,

  toPlace: Joi.string().trim().min(1).max(50),
  toPincode: pincode,
  toStateCode: stateCode,
}).unknown(false);

const recordSchema = Joi.object({
  version,

  ewbNumber: Joi.string()
    .trim()
    .pattern(EWB_NUMBER_REGEX)
    .required()
    .messages({ "string.pattern.base": "E-way bill number must be 12 digits" }),

  ewbDate: instant.required(),

  // Optional. Derived from distance when omitted.
  validUntil: instant,
}).unknown(false);

const vehicleSchema = Joi.object({
  version,

  vehicleNumber: vehicleNumber.required(),

  reason: Joi.string()
    .valid(...VEHICLE_UPDATE_REASONS)
    .required(),

  remarks: optionalText(500),

  fromPlace: Joi.string().trim().min(1).max(50).required(),
  fromStateCode: stateCode.required(),

  transportDocNumber: optionalText(100),
  transportDocDate: dateOnly.allow("", null),
}).unknown(false);

const extendSchema = Joi.object({
  version,

  newValidUntil: instant.required(),

  reason: Joi.string()
    .valid(...EXTEND_REASONS)
    .required(),

  remarks: optionalText(500),

  remainingDistanceKm: Joi.number()
    .integer()
    .min(1)
    .max(MAX_DISTANCE_KM)
    .strict()
    .required(),

  currentPlace: Joi.string().trim().min(1).max(50).required(),
  currentStateCode: stateCode.required(),
}).unknown(false);

const cancelSchema = Joi.object({
  version,

  reason: Joi.string()
    .valid(...CANCEL_REASONS)
    .required(),

  remarks: optionalText(500),
}).unknown(false);

/*
 * Writes to req.validatedBody so the sales invoice validators that
 * overwrite req.body are never affected.
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body ?? {}, {
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

  req.validatedBody = value;

  return next();
};

module.exports = {
  validateSaveEwayBillDetails: validate(detailsSchema),
  validateRecordEwayBill: validate(recordSchema),
  validateUpdateEwayBillVehicle: validate(vehicleSchema),
  validateExtendEwayBill: validate(extendSchema),
  validateCancelEwayBill: validate(cancelSchema),
};
