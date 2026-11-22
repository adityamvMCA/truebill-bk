const Joi = require("joi");

const editable = {
  transporterId: Joi.string().trim().uppercase().max(50).required().messages({
    "string.empty": "Transporter ID / GSTIN is required",
    "any.required": "Transporter ID / GSTIN is required",
  }),
  transporterName: Joi.string().trim().max(200).required().messages({
    "string.empty": "Transporter name is required",
    "any.required": "Transporter name is required",
  }),
  transportMode: Joi.string()
    .valid("ROAD", "RAIL", "AIR", "SHIP")
    .default("ROAD"),
  vehicleNumber: Joi.string().trim().uppercase().max(30).allow("", null),
  vehicleType: Joi.string().valid("REGULAR", "ODC").default("REGULAR"),
  phone: Joi.string().trim().max(20).allow("", null),
  email: Joi.string().trim().email().lowercase().max(100).allow("", null),
  address: Joi.string().trim().max(500).allow("", null),
  city: Joi.string().trim().max(100).allow("", null),
  state: Joi.string().trim().max(100).allow("", null),
  pincode: Joi.string().trim().max(10).allow("", null),
  distanceKm: Joi.number().min(0).max(4000).allow(null).default(0),
  status: Joi.string().valid("ACTIVE", "INACTIVE").default("ACTIVE"),
  notes: Joi.string().trim().max(1000).allow("", null),
};

const createSchema = Joi.object(editable).unknown(false);
const updateSchema = Joi.object(editable).unknown(false);

const idParamsSchema = Joi.object({
  id: Joi.string()
    .hex()
    .length(24)
    .required()
    .messages({ "string.length": "Invalid transporter ID" }),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),
  status: Joi.string().valid("ACTIVE", "INACTIVE"),
  transportMode: Joi.string().valid("ROAD", "RAIL", "AIR", "SHIP"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
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
        errors: error.details.map((d) => d.message),
      });
    }
    if (source === "body") req.body = value;
    else if (source === "query") req.validatedQuery = value;
    else req.validatedParams = value;
    next();
  };

module.exports = {
  validateCreateTransporter: validate(createSchema),
  validateUpdateTransporter: validate(updateSchema),
  validateTransporterParams: validate(idParamsSchema, "params"),
  validateListTransporters: validate(listSchema, "query"),
};
