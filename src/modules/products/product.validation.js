const Joi = require("joi");

const PRODUCT_TYPES = [
  "GOODS",
  "SERVICE",
];

const PRODUCT_STATUS = [
  "ACTIVE",
  "INACTIVE",
];

const optionalText = (maxLength) =>
  Joi.string()
    .trim()
    .max(maxLength)
    .allow("", null);

const productFields = {
  name: Joi.string()
    .trim()
    .min(2)
    .max(200)
    .messages({
      "string.empty":
        "Product name is required",

      "string.min":
        "Product name must contain at least 2 characters",

      "string.max":
        "Product name cannot exceed 200 characters",
    }),

  type: Joi.string()
    .trim()
    .uppercase()
    .valid(...PRODUCT_TYPES)
    .messages({
      "any.only":
        "Product type must be GOODS or SERVICE",
    }),

  category: optionalText(100),

  brand: optionalText(100),

  description: optionalText(1000),

  unit: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z][A-Z0-9_]{0,19}$/)
    .messages({
      "string.pattern.base":
        "Unit must be a valid unit code containing up to 20 letters, numbers, or underscores",
    }),

  hsnSacCode: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z0-9]{2,20}$/)
    .allow("", null)
    .messages({
      "string.pattern.base":
        "HSN/SAC code must contain 2–20 letters or numbers",
    }),

  gstRate: Joi.number()
    .min(0)
    .max(100)
    .strict()
    .messages({
      "number.min":
        "GST rate must be between 0 and 100",

      "number.max":
        "GST rate must be between 0 and 100",
    }),

  salePrice: Joi.number()
    .min(0)
    .max(1000000000)
    .precision(2),

  purchasePrice: Joi.number()
    .min(0)
    .max(1000000000)
    .precision(2),

  trackInventory: Joi.boolean(),

  openingStock: Joi.number()
    .min(0)
    .max(1000000)
    .precision(3),

  openingStockRate: Joi.number()
    .min(0)
    .max(1000000000)
    .precision(2),

  reorderLevel: Joi.number()
    .min(0)
    .max(1000000)
    .precision(3),

  status: Joi.string()
    .trim()
    .uppercase()
    .valid(...PRODUCT_STATUS)
    .messages({
      "any.only":
        "Status must be ACTIVE or INACTIVE",
    }),
};

const validateProductType = (
  value,
  helpers,
) => {
  if (
    value.type === "SERVICE" &&
    value.trackInventory === true
  ) {
    return helpers.error(
      "any.custom",
      {
        message:
          "Services cannot track inventory",
      },
    );
  }

  return value;
};

const createProductSchema = Joi.object({
  ...productFields,

  name: productFields.name
    .required()
    .messages({
      "any.required":
        "Product name is required",
    }),

  type: productFields.type
    .default("GOODS"),

  unit: productFields.unit
    .default("NOS"),

  gstRate: productFields.gstRate
    .default(18),

  salePrice: productFields.salePrice
    .default(0),

  purchasePrice:
    productFields.purchasePrice
      .default(0),

  trackInventory:
    productFields.trackInventory
      .when("type", {
        is: "SERVICE",

        then: Joi.boolean()
          .valid(false)
          .default(false),

        otherwise: Joi.boolean()
          .default(true),
      }),

  openingStock:
    productFields.openingStock
      .default(0),

  openingStockRate:
    productFields.openingStockRate
      .default(0),

  reorderLevel:
    productFields.reorderLevel
      .default(0),

  status: productFields.status
    .default("ACTIVE"),
})
  .custom(
    validateProductType,
    "Product type validation",
  )
  .messages({
    "any.custom":
      "{{#message}}",
  });

const updateProductSchema = Joi.object({
  ...productFields,
})
  .min(1)
  .custom(
    validateProductType,
    "Product type validation",
  )
  .messages({
    "object.min":
      "Provide at least one field to update",

    "any.custom":
      "{{#message}}",
  });

const validateProduct = (schema) =>
  (req, res, next) => {
    const { error, value } =
      schema.validate(
        req.body ?? {},
        {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
        },
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",

        errors: error.details.map(
          (detail) =>
            detail.message,
        ),
      });
    }

    req.body = value;

    return next();
  };

module.exports = {
  validateCreateProduct:
    validateProduct(
      createProductSchema,
    ),

  validateUpdateProduct:
    validateProduct(
      updateProductSchema,
    ),
};