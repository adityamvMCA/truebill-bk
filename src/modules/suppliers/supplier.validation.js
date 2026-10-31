// const Joi = require("joi");

// const emptyToNull = (value, helpers) => {
//   if (typeof value === "string" && value.trim() === "") {
//     return null;
//   }

//   return value;
// };

// const optionalText = Joi.string().trim().allow(null, "").custom(emptyToNull);

// const createSupplierSchema = Joi.object({
//   supplierName: Joi.string().trim().min(2).max(200).required().messages({
//     "string.empty": "Supplier name is required",
//     "any.required": "Supplier name is required",
//     "string.min": "Supplier name must contain at least 2 characters",
//   }),

//   supplierType: Joi.string()
//     .valid("Business", "Individual")
//     .default("Business"),

//   contactPerson: optionalText,

//   phone: Joi.string()
//     .trim()
//     .pattern(/^[0-9+\-() ]{7,20}$/)
//     .allow(null, "")
//     .messages({
//       "string.pattern.base": "Enter a valid phone number",
//     }),

//   alternatePhone: Joi.string()
//     .trim()
//     .pattern(/^[0-9+\-() ]{7,20}$/)
//     .allow(null, "")
//     .messages({
//       "string.pattern.base": "Enter a valid alternate phone number",
//     }),

//   email: Joi.string()
//     .trim()
//     .lowercase()
//     .email({ tlds: { allow: false } })
//     .allow(null, "")
//     .messages({
//       "string.email": "Enter a valid email address",
//     }),

//   gstNo: Joi.string()
//     .trim()
//     .uppercase()
//     .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/)
//     .allow(null, "")
//     .messages({
//       "string.pattern.base": "Enter a valid GST number",
//     }),

//   panNo: Joi.string()
//     .trim()
//     .uppercase()
//     .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
//     .allow(null, "")
//     .messages({
//       "string.pattern.base": "Enter a valid PAN number",
//     }),

//   billingAddress: optionalText,
//   shippingAddress: optionalText,
//   city: optionalText,
//   state: optionalText,

//   pincode: Joi.string()
//     .trim()
//     .pattern(/^[0-9]{6}$/)
//     .allow(null, "")
//     .messages({
//       "string.pattern.base": "Pincode must contain 6 digits",
//     }),

//   country: Joi.string().trim().max(100).default("India"),

//   paymentTerms: Joi.string().trim().max(100).default("Due on Receipt"),

//   creditLimit: Joi.number().min(0).precision(2).default(0),

//   creditDays: Joi.number().integer().min(0).default(0),

//   openingBalance: Joi.number().min(0).precision(2).default(0),

//   openingBalanceType: Joi.string().valid("DEBIT", "CREDIT").default("CREDIT"),

//   status: Joi.string().valid("Active", "Inactive").default("Active"),

//   notes: optionalText,
// });

// const updateSupplierSchema = createSupplierSchema
//   .fork(["supplierName"], (schema) => schema.optional())
//   .min(1);

// const validateSupplier = (schema) => (req, res, next) => {
//   const { error, value } = schema.validate(req.body, {
//     abortEarly: false,
//     stripUnknown: true,
//     convert: true,
//   });

//   if (error) {
//     return res.status(400).json({
//       success: false,
//       message: "Validation failed",
//       errors: error.details.map((detail) => detail.message),
//     });
//   }

//   req.body = value;

//   next();
// };

// module.exports = {
//   createSupplierSchema,
//   validateCreateSupplier: validateSupplier(createSupplierSchema),
//   validateUpdateSupplier: validateSupplier(updateSupplierSchema),
// };


const Joi = require("joi");

const emptyToNull = (value, helpers) => {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  return value;
};

const optionalText = Joi.string().trim().allow(null, "").custom(emptyToNull);

const createSupplierSchema = Joi.object({
  supplierName: Joi.string().trim().min(2).max(200).required().messages({
    "string.empty": "Supplier name is required",
    "any.required": "Supplier name is required",
    "string.min": "Supplier name must contain at least 2 characters",
  }),

  supplierType: Joi.string().valid("Business", "Individual").default("Business"),

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

  country: Joi.string().trim().max(100).default("India"),
  paymentTerms: Joi.string().trim().max(100).default("Due on Receipt"),
  creditLimit: Joi.number().min(0).precision(2).default(0),
  creditDays: Joi.number().integer().min(0).default(0),
  openingBalance: Joi.number().min(0).precision(2).default(0),
  openingBalanceType: Joi.string().valid("DEBIT", "CREDIT").default("CREDIT"),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
  notes: optionalText,
});

const updateSupplierSchema = createSupplierSchema
  .fork(["supplierName"], (schema) => schema.optional())
  .min(1);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),
  status: Joi.string().valid("Active", "Inactive").allow("").default(""),
  supplierType: Joi.string().valid("Business", "Individual").allow("").default(""),
  openingBalanceType: Joi.string().valid("DEBIT", "CREDIT").allow("").default(""),
  state: Joi.string().trim().max(60).allow("").default(""),
  sortBy: Joi.string()
    .valid(
      "supplierCode",
      "supplierName",
      "supplierType",
      "contactPerson",
      "phone",
      "email",
      "gstNo",
      "city",
      "state",
      "paymentTerms",
      "creditLimit",
      "creditDays",
      "payableBalance",
      "status",
      "createdAt"
    )
    .allow("")
    .default(""),
  sortOrder: Joi.string().valid("asc", "desc").allow("").default(""),
  page: Joi.number().integer().min(1).max(100000).default(1),
  limit: Joi.number().integer().valid(20, 50, 100).default(20),
}).unknown(false);

const bulkStatusSchema = Joi.object({
  ids: Joi.array()
    .items(Joi.string().trim().pattern(/^[a-f\d]{24}$/i))
    .min(1)
    .max(1000)
    .unique()
    .required(),
  status: Joi.string().valid("Active", "Inactive").required(),
}).unknown(false);

const validateSupplier = (schema) => (req, res, next) => {
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

const validateListSupplier = (req, res, next) => {
  const { error, value } = listSchema.validate(req.query ?? {}, {
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

  req.query = value;
  next();
};

const validateBulkStatusSupplier = (req, res, next) => {
  const { error, value } = bulkStatusSchema.validate(req.body, {
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
  createSupplierSchema,
  validateCreateSupplier: validateSupplier(createSupplierSchema),
  validateUpdateSupplier: validateSupplier(updateSupplierSchema),
  validateListSupplier,
  validateBulkStatusSupplier,
};