const Joi = require("joi");

const emptyToNull = (value, helpers) => {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return value;
};

const optionalText = Joi.string()
  .trim()
  .allow(null, "")
  .custom(emptyToNull);

const createCustomerSchema = Joi.object({
  customerName: Joi.string()
    .trim()
    .min(2)
    .max(200)
    .required()
    .messages({
      "string.empty": "Customer name is required",
      "any.required": "Customer name is required",
      "string.min": "Customer name must contain at least 2 characters",
    }),

  customerType: Joi.string()
    .valid("Business", "Individual")
    .default("Business"),

  contactPerson: optionalText,

  phone: Joi.string()
    .trim()
    .pattern(/^[0-9+\-() ]{7,20}$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "Enter a valid phone number",
    }),

  alternatePhone: Joi.string()
    .trim()
    .pattern(/^[0-9+\-() ]{7,20}$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "Enter a valid alternate phone number",
    }),

  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .allow(null, "")
    .messages({
      "string.email": "Enter a valid email address",
    }),

  gstNo: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "Enter a valid GST number",
    }),

  panNo: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "Enter a valid PAN number",
    }),

  billingAddress: optionalText,
  shippingAddress: optionalText,
  city: optionalText,
  state: optionalText,

  pincode: Joi.string()
    .trim()
    .pattern(/^[0-9]{6}$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "Pincode must contain 6 digits",
    }),

  country: Joi.string()
    .trim()
    .max(100)
    .default("India"),

  paymentTerms: Joi.string()
    .trim()
    .max(100)
    .default("Due on Receipt"),

  creditLimit: Joi.number()
    .min(0)
    .precision(2)
    .default(0),

  creditDays: Joi.number()
    .integer()
    .min(0)
    .default(0),

  openingBalance: Joi.number()
    .min(0)
    .precision(2)
    .default(0),

  openingBalanceType: Joi.string()
    .valid("DEBIT", "CREDIT")
    .default("DEBIT"),

  priceList: Joi.string()
    .trim()
    .max(100)
    .default("Standard"),

  status: Joi.string()
    .valid("Active", "Inactive")
    .default("Active"),

  notes: optionalText,
});

const updateCustomerSchema = createCustomerSchema
  .fork(["customerName"], (schema) => schema.optional())
  .min(1);

const validateCustomer = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.details.map((detail) => detail.message),
    });
  }

  req.body = value;
  next();
};

module.exports = {
  validateCreateCustomer: validateCustomer(createCustomerSchema),
  validateUpdateCustomer: validateCustomer(updateCustomerSchema),
};