const Joi = require("joi");

const GST_RATES = [0, 3, 5, 12, 18, 28];

const TAX_MODES = [
  "NONE",
  "INTRA_STATE",
  "INTER_STATE",
];

const ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base":
      "{{#label}} must be a valid ObjectId",
  });

const optionalObjectId = objectId.allow(null, "");

const dateValue = Joi.string()
  .trim()
  .isoDate()
  .messages({
    "string.isoDate":
      "{{#label}} must be a valid ISO date",
  });

const optionalDate = dateValue.allow(null, "");

const optionalText = (maxLength) =>
  Joi.string()
    .trim()
    .max(maxLength)
    .allow(null, "");

const versionValue = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .strict()
  .messages({
    "any.required":
      "Document version is required",
    "number.base":
      "Document version must be a number",
    "number.integer":
      "Document version must be an integer",
    "number.min":
      "Document version cannot be negative",
  });

const unitRate = Joi.number()
  .min(0)
  .max(1000000000)
  .precision(2)
  .strict();

const unitRatePaise = Joi.number()
  .integer()
  .min(0)
  .max(100000000000)
  .strict();

const itemSchema = Joi.object({
  lineId: optionalObjectId,

  quotationLineId: optionalObjectId,

  productId: objectId.required(),

  quantity: Joi.number()
    .min(0.001)
    .max(1000000)
    .precision(3)
    .strict()
    .required(),

  // Accept rupees from the form or paise from
  // existing order / quotation lines.
  unitRate,

  unitRatePaise,

  discountPercent: Joi.number()
    .min(0)
    .max(100)
    .precision(2)
    .strict()
    .default(0),

  // Omission lets the service use Product GST.
  gstRate: Joi.number()
    .valid(...GST_RATES)
    .strict(),

  specification: optionalText(1000),

  // Accepted for compatibility.
  // The service resolves snapshots from tenant products.
  productCode: optionalText(50),
  productName: optionalText(200),

  productType: Joi.string()
    .valid("GOODS", "SERVICE")
    .allow(null, ""),

  unit: optionalText(20),
  hsnSacCode: optionalText(20),
})
  .or("unitRate", "unitRatePaise")
  .unknown(false)
  .messages({
    "object.missing":
      "Each item requires unitRate or unitRatePaise",
  });

const itemsSchema = Joi.array()
  .items(itemSchema)
  .min(1)
  .max(200)
  .messages({
    "array.min":
      "A sales order requires at least one item",
    "array.max":
      "A sales order cannot contain more than 200 items",
  });

const createOrderSchema = Joi.object({
  sourceQuotationId: optionalObjectId,

  customerId: objectId.required(),

  orderDate: dateValue.required(),

  expectedDeliveryDate: optionalDate,

  // No null defaults: omission is preserved so the
  // service can fall back to Customer addresses.
  billingAddress: optionalText(2000),
  shippingAddress: optionalText(2000),

  taxMode: Joi.string()
    .valid(...TAX_MODES)
    .required(),

  paymentTerms: optionalText(100),
  deliveryTerms: optionalText(1000),

  items: itemsSchema.required(),

  notes: optionalText(1000),
  termsAndConditions: optionalText(5000),

  action: Joi.string()
    .valid("SAVE", "CONFIRM")
    .default("SAVE"),
}).unknown(false);

const EDITABLE_FIELDS = [
  "orderDate",
  "expectedDeliveryDate",
  "billingAddress",
  "shippingAddress",
  "taxMode",
  "paymentTerms",
  "deliveryTerms",
  "items",
  "notes",
  "termsAndConditions",
];

const updateOrderSchema = Joi.object({
  // Optional here for compatibility with the
  // existing update form. Status actions require it.
  version: versionValue,

  orderDate: dateValue,

  expectedDeliveryDate: optionalDate,

  billingAddress: optionalText(2000),
  shippingAddress: optionalText(2000),

  taxMode: Joi.string().valid(...TAX_MODES),

  paymentTerms: optionalText(100),
  deliveryTerms: optionalText(1000),

  items: itemsSchema,

  notes: optionalText(1000),
  termsAndConditions: optionalText(5000),
})
  .unknown(false)
  .custom((value, helpers) => {
    const hasEditableField = EDITABLE_FIELDS.some(
      (field) =>
        Object.prototype.hasOwnProperty.call(
          value,
          field,
        ),
    );

    if (!hasEditableField) {
      return helpers.message({
        custom:
          "Provide at least one editable field",
      });
    }

    return value;
  });

const orderNumberParamsSchema = Joi.object({
  orderNumber: Joi.string()
    .trim()
    .uppercase()
    .max(100)
    .required(),
}).unknown(false);

// Version belongs in the BODY, never in URL params.
const versionBodySchema = Joi.object({
  version: versionValue.required(),
}).unknown(false);

const cancelOrderSchema = Joi.object({
  version: versionValue.required(),

  cancellationReason: optionalText(1000)
    .default(null),
}).unknown(false);

const listOrdersSchema = Joi.object({
  search: Joi.string()
    .trim()
    .max(100)
    .allow("")
    .default(""),

  status: Joi.string()
    .valid(...ORDER_STATUSES)
    .allow(null, ""),

  customerId: optionalObjectId,
  sourceQuotationId: optionalObjectId,

  orderDateFrom: optionalDate,
  orderDateTo: optionalDate,

  expectedDeliveryFrom: optionalDate,
  expectedDeliveryTo: optionalDate,

  page: Joi.number()
    .integer()
    .min(1)
    .default(1),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(20),
})
  .unknown(false)
  .custom((value, helpers) => {
    const ranges = [
      [
        value.orderDateFrom,
        value.orderDateTo,
      ],
      [
        value.expectedDeliveryFrom,
        value.expectedDeliveryTo,
      ],
    ];

    for (const [from, to] of ranges) {
      if (
        from &&
        to &&
        new Date(to) < new Date(from)
      ) {
        return helpers.message({
          custom:
            "Date range end cannot be before its start",
        });
      }
    }

    return value;
  });

const quotationIdParamsSchema = Joi.object({
  quotationId: objectId.required(),
}).unknown(false);

const convertQuotationSchema = Joi.object({
  orderDate: optionalDate,
  expectedDeliveryDate: optionalDate,

  billingAddress: optionalText(2000),
  shippingAddress: optionalText(2000),

  taxMode: Joi.string().valid(...TAX_MODES),

  paymentTerms: optionalText(100),
  deliveryTerms: optionalText(1000),

  items: itemsSchema,

  notes: optionalText(1000),
  termsAndConditions: optionalText(5000),

  action: Joi.string()
    .valid("SAVE", "CONFIRM")
    .default("SAVE"),
}).unknown(false);

const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const { error, value } = schema.validate(
      req[source] ?? {},
      {
        abortEarly: false,
        convert: true,
      },
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (detail) => detail.message,
        ),
      });
    }

    if (source === "body") {
      req.validatedBody = value;
    } else if (source === "query") {
      req.validatedQuery = value;
    } else {
      req.validatedParams = value;
    }

    return next();
  };
};

module.exports = {
  validateCreateSalesOrder:
    validate(createOrderSchema),

  validateUpdateSalesOrder:
    validate(updateOrderSchema),

  validateSalesOrderParams:
    validate(
      orderNumberParamsSchema,
      "params",
    ),

  // Same params schema for status endpoints:
  // only orderNumber is present in the URL.
  validateSalesOrderStatusParams:
    validate(
      orderNumberParamsSchema,
      "params",
    ),

  validateSalesOrderVersion:
    validate(versionBodySchema),

  validateCancelSalesOrder:
    validate(cancelOrderSchema),

  validateListSalesOrders:
    validate(listOrdersSchema, "query"),

  validateConvertQuotation:
    validate(convertQuotationSchema),

  validateQuotationIdParams:
    validate(
      quotationIdParamsSchema,
      "params",
    ),
};