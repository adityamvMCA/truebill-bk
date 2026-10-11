const Joi = require("joi");

const PRODUCT_TYPES = ["GOODS", "SERVICE"];

const PRODUCT_STATUS = ["ACTIVE", "INACTIVE"];

const UNITS = [
  "NOS",
  "PCS",
  "BOX",
  "BAG",
  "PACK",
  "SET",
  "KG",
  "GRAM",
  "TON",
  "LITRE",
  "ML",
  "METER",
  "FEET",
  "SQFT",
  "SQM",
  "HOUR",
  "DAY",
  "MONTH",
];

const GST_RATES = [0, 3, 5, 12, 18, 28];

const optionalText = Joi.string()
  .trim()
  .allow("", null);

const productFields = {
  name: Joi.string()
    .trim()
    .min(2)
    .max(200)
    .messages({
      "string.empty": "Product name is required",
      "string.min": "Product name must contain at least 2 characters",
      "string.max": "Product name cannot exceed 200 characters",
    }),

  type: Joi.string()
    .uppercase()
    .valid(...PRODUCT_TYPES)
    .default("GOODS")
    .messages({
      "any.only": "Product type must be GOODS or SERVICE",
    }),

  category: Joi.string()
    .trim()
    .max(100)
    .allow("", null)
    .messages({
      "string.max": "Category cannot exceed 100 characters",
    }),

  brand: Joi.string()
    .trim()
    .max(100)
    .allow("", null)
    .messages({
      "string.max": "Brand cannot exceed 100 characters",
    }),

  description: Joi.string()
    .trim()
    .max(1000)
    .allow("", null)
    .messages({
      "string.max": "Description cannot exceed 1000 characters",
    }),

  unit: Joi.string()
    .uppercase()
    .valid(...UNITS)
    .default("NOS")
    .messages({
      "any.only": `Unit must be one of: ${UNITS.join(", ")}`,
    }),

  hsnSacCode: Joi.string()
    .trim()
    .uppercase()
    .max(20)
    .allow("", null)
    .messages({
      "string.max": "HSN/SAC code cannot exceed 20 characters",
    }),

  gstRate: Joi.number()
    .valid(...GST_RATES)
    .default(18)
    .messages({
      "any.only": `GST rate must be one of: ${GST_RATES.join(", ")}`,
    }),

  salePrice: Joi.number()
    .min(0)
    .precision(2)
    .default(0)
    .messages({
      "number.min": "Sale price cannot be negative",
    }),

  purchasePrice: Joi.number()
    .min(0)
    .precision(2)
    .default(0)
    .messages({
      "number.min": "Purchase price cannot be negative",
    }),

  trackInventory: Joi.boolean()
    .default(true),

  openingStock: Joi.number()
    .min(0)
    .precision(3)
    .default(0)
    .messages({
      "number.min": "Opening stock cannot be negative",
    }),

  openingStockRate: Joi.number()
    .min(0)
    .precision(2)
    .default(0)
    .messages({
      "number.min": "Opening stock rate cannot be negative",
    }),

  reorderLevel: Joi.number()
    .min(0)
    .precision(3)
    .default(0)
    .messages({
      "number.min": "Reorder level cannot be negative",
    }),

  status: Joi.string()
    .uppercase()
    .valid(...PRODUCT_STATUS)
    .default("ACTIVE")
    .messages({
      "any.only": "Status must be ACTIVE or INACTIVE",
    }),
};

const createProductSchema = Joi.object({
  ...productFields,

  name: productFields.name.required().messages({
    "any.required": "Product name is required",
    "string.empty": "Product name is required",
  }),
}).custom((value, helpers) => {
  if (value.type === "SERVICE" && value.trackInventory) {
    return helpers.error("any.custom", {
      message: "Services cannot track inventory",
    });
  }

  return value;
}, "Product type validation").messages({
  "any.custom": "{{#message}}",
});

const updateProductSchema = Joi.object(productFields)
  .min(1)
  .custom((value, helpers) => {
    if (value.type === "SERVICE" && value.trackInventory) {
      return helpers.error("any.custom", {
        message: "Services cannot track inventory",
      });
    }

    return value;
  }, "Product type validation")
  .messages({
    "object.min": "Provide at least one field to update",
    "any.custom": "{{#message}}",
  });

const validateProduct = (schema) => {
  return (req, res, next) => {
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
};

module.exports = {
  validateCreateProduct: validateProduct(createProductSchema),
  validateUpdateProduct: validateProduct(updateProductSchema),
};