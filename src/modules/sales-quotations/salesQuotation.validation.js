const Joi = require("joi");

const QUOTATION_STATUSES = [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
];

const TAX_MODES = ["NONE", "INTRA_STATE", "INTER_STATE"];

const GST_RATES = [0, 3, 5, 12, 18, 28];

const MAX_QUOTATION_ITEMS = 200;

const objectId = Joi.string().trim().hex().length(24);

const optionalText = (max) => Joi.string().trim().max(max).allow(null, "");

const requiredText = (max) => Joi.string().trim().min(1).max(max).required();

const date = Joi.date().iso();

const nonNegativeInteger = Joi.number()
  .integer()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const scaledDecimal = (max, scale) =>
  Joi.number()
    .min(0)
    .max(max)
    .custom((value, helpers) => {
      const scaled = value * scale;
      const rounded = Math.round(scaled);

      if (
        !Number.isSafeInteger(rounded) ||
        Math.abs(scaled - rounded) > 0.000001
      ) {
        return helpers.error("number.maxDecimals", {
          decimals: Math.log10(scale),
        });
      }

      return value;
    })
    .messages({
      "number.maxDecimals":
        "{{#label}} must have at most {{#decimals}} decimal places",
    });

const quantity = scaledDecimal(1000000, 1000);

const percentage = scaledDecimal(100, 100);

const quotationItem = Joi.object({
  productId: objectId.required(),

  productCode: requiredText(50),

  productName: requiredText(200),

  productType: Joi.string()
    .trim()
    .uppercase()
    .valid("GOODS", "SERVICE")
    .required(),

  unit: requiredText(20),

  hsnSacCode: Joi.string()
    .trim()
    .uppercase()
    .max(20)
    .allow(null, "")
    .default(null),

  specification: optionalText(1000),

  quantity: quantity.required(),

  unitRatePaise: nonNegativeInteger.required(),

  discountPercent: percentage.required(),

  gstRate: Joi.number()
    .valid(...GST_RATES)
    .required(),

  // Retained only when revising an existing quotation.
  lineId: objectId.allow(null, ""),
}).unknown(false);

const createQuotation = Joi.object({
  customerId: objectId.required(),

  enquiryReference: optionalText(100),

  // Optional. The service resolves or creates this
  // when comparing alternatives for the same requirement.
  comparisonGroupId: objectId.allow(null, ""),

  quotationDate: date.required(),

  validUntil: date.required(),

  expectedDeliveryDate: date.allow(null, ""),

  deliveryTerms: optionalText(1000),

  paymentTerms: requiredText(100),

  taxMode: Joi.string()
    .valid(...TAX_MODES)
    .required(),

  items: Joi.array()
    .items(quotationItem)
    .min(1)
    .max(MAX_QUOTATION_ITEMS)
    .required(),

  notes: optionalText(1000),

  termsAndConditions: optionalText(5000),
})
  .unknown(false)
  .custom((value, helpers) => {
    const { quotationDate, validUntil, expectedDeliveryDate, taxMode, items } =
      value;

    if (validUntil < quotationDate) {
      return helpers.error("any.invalid", {
        message: "validUntil cannot be before quotationDate",
      });
    }

    if (expectedDeliveryDate && expectedDeliveryDate < quotationDate) {
      return helpers.error("any.invalid", {
        message: "expectedDeliveryDate cannot be before quotationDate",
      });
    }

    if (taxMode === "NONE" && items.some((item) => item.gstRate !== 0)) {
      return helpers.error("any.invalid", {
        message: "No-GST quotations cannot contain a non-zero GST rate",
      });
    }

    if (
      taxMode === "INTRA_STATE" &&
      items.some((item) => item.gstRate !== 0 && item.gstRate % 2 !== 0)
    ) {
      return helpers.error("any.invalid", {
        message:
          "Intra-state GST rates must be evenly split between CGST and SGST",
      });
    }

    return value;
  })
  .messages({
    "any.invalid": "{{#message}}",
  });

const updateDraftQuotation = Joi.object({
  customerId: objectId,

  enquiryReference: optionalText(100),

  comparisonGroupId: objectId.allow(null, ""),

  quotationDate: date,

  validUntil: date,

  expectedDeliveryDate: date.allow(null, ""),

  deliveryTerms: optionalText(1000),

  paymentTerms: requiredText(100),

  taxMode: Joi.string().valid(...TAX_MODES),

  items: Joi.array().items(quotationItem).min(1).max(MAX_QUOTATION_ITEMS),

  notes: optionalText(1000),

  termsAndConditions: optionalText(5000),
})
  .min(1)
  .unknown(false);

const issueQuotation = Joi.object({
  version: Joi.number().integer().min(0).required(),
})
  .unknown(false)
  .required();

const createRevision = Joi.object({
  revisionReason: optionalText(1000),

  customerId: objectId,

  enquiryReference: optionalText(100),

  comparisonGroupId: objectId.allow(null, ""),

  quotationDate: date,

  validUntil: date,

  expectedDeliveryDate: date.allow(null, ""),

  deliveryTerms: optionalText(1000),

  paymentTerms: requiredText(100),

  taxMode: Joi.string().valid(...TAX_MODES),

  items: Joi.array().items(quotationItem).min(1).max(MAX_QUOTATION_ITEMS),

  notes: optionalText(1000),

  termsAndConditions: optionalText(5000),
})
  .min(1)
  .unknown(false)
  .custom((value, helpers) => {
    const { quotationDate, validUntil, expectedDeliveryDate } = value;

    if (quotationDate && validUntil && validUntil < quotationDate) {
      return helpers.error("any.invalid", {
        message: "validUntil cannot be before quotationDate",
      });
    }

    if (
      quotationDate &&
      expectedDeliveryDate &&
      expectedDeliveryDate < quotationDate
    ) {
      return helpers.error("any.invalid", {
        message: "expectedDeliveryDate cannot be before quotationDate",
      });
    }

    return value;
  })
  .messages({
    "any.invalid": "{{#message}}",
  });

const acceptQuotation = Joi.object({
  version: Joi.number().integer().min(0).required(),

  acceptanceReference: optionalText(200),
})
  .unknown(false)
  .required();

const rejectQuotation = Joi.object({
  version: Joi.number().integer().min(0).required(),

  rejectionReason: optionalText(1000),
})
  .unknown(false)
  .required();

const cancelQuotation = Joi.object({
  version: Joi.number().integer().min(0).required(),

  cancellationReason: optionalText(1000),
})
  .unknown(false)
  .required();

const deleteDraftQuotation = Joi.object({
  version: Joi.number().integer().min(0).required(),
})
  .unknown(false)
  .required();

const listQuotations = Joi.object({
  page: Joi.number().integer().min(1).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),

  search: Joi.string().trim().max(200).allow(null, ""),

  customerId: objectId.allow(null, ""),

  status: Joi.string()
    .valid(...QUOTATION_STATUSES)
    .allow(null, ""),

  comparisonGroupId: objectId.allow(null, ""),

  quotationFamilyId: objectId.allow(null, ""),

  validUntilFrom: date.allow(null, ""),

  validUntilTo: date.allow(null, ""),

  includeDeleted: Joi.boolean().default(false),
})
  .unknown(false)
  .custom((value, helpers) => {
    if (
      value.validUntilFrom &&
      value.validUntilTo &&
      value.validUntilTo < value.validUntilFrom
    ) {
      return helpers.error("any.invalid", {
        message: "validUntilTo cannot be before validUntilFrom",
      });
    }

    return value;
  })
  .messages({
    "any.invalid": "{{#message}}",
  });

const quotationIdParam = Joi.object({
  id: objectId.required(),
})
  .unknown(false)
  .required();

const compareQuotations = Joi.object({
  comparisonGroupId: objectId.required(),
})
  .unknown(false)
  .required();

const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const input =
      source === "body"
        ? (req.body ?? {})
        : source === "query"
          ? (req.query ?? {})
          : (req.params ?? {});

    const { error, value } = schema.validate(input, {
      abortEarly: false,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((detail) => detail.message),
      });
    }

    if (source === "body") {
      req.body = value;
    } else if (source === "query") {
      req.validatedQuery = value;
    } else {
      req.validatedParams = value;
    }

    return next();
  };
};

module.exports = {
  validateCreateQuotation: validate(createQuotation, "body"),

  validateUpdateDraftQuotation: validate(updateDraftQuotation, "body"),

  validateIssueQuotation: validate(issueQuotation, "body"),

  validateCreateRevision: validate(createRevision, "body"),

  validateAcceptQuotation: validate(acceptQuotation, "body"),

  validateRejectQuotation: validate(rejectQuotation, "body"),

  validateCancelQuotation: validate(cancelQuotation, "body"),

  validateDeleteDraftQuotation: validate(deleteDraftQuotation, "body"),

  validateListQuotations: validate(listQuotations, "query"),

  validateQuotationIdParam: validate(quotationIdParam, "params"),

  validateCompareQuotations: validate(compareQuotations, "query"),
};
