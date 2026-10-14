const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({
    "string.pattern.base":
      "{{#label}} must be a valid ObjectId",
  });

const paymentAmount = Joi.number()
  .min(0.01)
  .max(1000000000)
  .precision(2)
  .strict();

const allocationSchema = Joi.object({
  purchaseBillId: objectId.required(),

  amount: paymentAmount.required(),
}).unknown(false);

const createSupplierPaymentSchema = Joi.object({
  requestId: Joi.string()
    .trim()
    .lowercase()
    .guid({ version: ["uuidv4"] })
    .required(),

  supplierId: objectId.required(),

  paymentLedgerId: objectId.required(),

  paymentDate: Joi.date()
    .iso()
    .required(),

  paymentMethod: Joi.string()
    .valid(
      "CASH",
      "BANK_TRANSFER",
      "UPI",
      "CHEQUE",
      "CARD",
    )
    .required(),

  referenceNumber: Joi.string()
    .trim()
    .max(100)
    .allow("", null),

  amount: paymentAmount.required(),

  allocations: Joi.array()
    .items(allocationSchema)
    .min(1)
    .max(200)
    .unique(
      (first, second) =>
        first.purchaseBillId.toLowerCase() ===
        second.purchaseBillId.toLowerCase(),
    )
    .required()
    .messages({
      "array.unique":
        "A purchase bill can appear only once in allocations",
    }),

  notes: Joi.string()
    .trim()
    .max(1000)
    .allow("", null),
})
  .custom((value, helpers) => {
    const amountPaise = Math.round(value.amount * 100);

    let allocatedPaise = 0;

    for (const allocation of value.allocations) {
      allocatedPaise += Math.round(allocation.amount * 100);
    }

    if (amountPaise !== allocatedPaise) {
      return helpers.error("any.custom", {
        message:
          "Allocated amounts must equal the payment amount",
      });
    }

    return value;
  })
  .messages({
    "any.custom": "{{#message}}",
  })
  .unknown(false);

const supplierPaymentParamsSchema = Joi.object({
  paymentNumber: Joi.string()
    .trim()
    .uppercase()
    .max(100)
    .required(),
}).unknown(false);

const listSupplierPaymentsSchema = Joi.object({
  search: Joi.string()
    .trim()
    .max(100)
    .allow("")
    .default(""),

  supplierId: objectId,

  paymentMethod: Joi.string().valid(
    "CASH",
    "BANK_TRANSFER",
    "UPI",
    "CHEQUE",
    "CARD",
  ),

  fromDate: Joi.date().iso(),

  toDate: Joi.date()
    .iso()
    .when("fromDate", {
      is: Joi.exist(),
      then: Joi.date().min(Joi.ref("fromDate")),
    }),

  page: Joi.number()
    .integer()
    .min(1)
    .default(1),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(20),
}).unknown(false);

const getUnpaidBillsSchema = Joi.object({
  supplierId: objectId.required(),

  page: Joi.number()
    .integer()
    .min(1)
    .default(1),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(100),
}).unknown(false);

const validate = (schema, source = "body") =>
  (req, res, next) => {
    const input =
      source === "body"
        ? req.body ?? {}
        : req[source];

    const { error, value } = schema.validate(input, {
      abortEarly: false,
      convert: true,
    });

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
      req.body = value;
    } else if (source === "query") {
      req.validatedQuery = value;
    } else {
      req.validatedParams = value;
    }

    next();
  };

module.exports = {
  validateCreateSupplierPayment: validate(
    createSupplierPaymentSchema,
  ),

  validateSupplierPaymentParams: validate(
    supplierPaymentParamsSchema,
    "params",
  ),

  validateListSupplierPayments: validate(
    listSupplierPaymentsSchema,
    "query",
  ),

  validateUnpaidSupplierBills: validate(
    getUnpaidBillsSchema,
    "query",
  ),
};