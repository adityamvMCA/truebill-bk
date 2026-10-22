const Joi = require("joi");

const productCode = Joi.string().trim().uppercase().min(1).max(50).required();

const quantity = Joi.number()
  .min(0.001)
  .max(1000000)
  .precision(3)
  .strict()
  .required();

const unitRate = Joi.number()
  .min(0)
  .max(1000000000)
  .precision(2)
  .strict()
  .default(0);

const reason = Joi.string()
  .valid("PHYSICAL_COUNT", "DAMAGE", "THEFT", "EXPIRY", "CORRECTION", "OTHER")
  .required();

const notes = Joi.string().trim().max(1000).allow(null, "");

const adjustmentDate = Joi.date()
  .max("now")
  .default(() => new Date());

const createSchema = Joi.object({
  productCode,
  adjustmentType: Joi.string().valid("INCREASE", "DECREASE").required(),

  quantity,
  unitRate,
  reason,
  notes,
  adjustmentDate,
}).unknown(false);

const listSchema = Joi.object({
  productCode: Joi.string().trim().uppercase().max(50).allow("", null),

  adjustmentType: Joi.string().valid("INCREASE", "DECREASE"),

  reason,

  fromDate: Joi.date().iso(),

  toDate: Joi.date().iso().greater(Joi.ref("fromDate")).messages({
    "date.greater": "To date must be after from date",
  }),

  page: Joi.number().integer().min(1).max(100000).strict().default(1),

  limit: Joi.number().integer().min(1).max(100).strict().default(20),
})
  .with("fromDate", "toDate")
  .unknown(false);

const validate =
  (schema, source = "body") =>
  (req, res, next) => {
    const { error, value } = schema.validate(req[source] ?? {}, {
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

    const targets = {
      body: "validatedBody",
      params: "validatedParams",
      query: "validatedQuery",
    };

    req[targets[source]] = value;

    return next();
  };

module.exports = {
  validateCreate: validate(createSchema),
  validateList: validate(listSchema, "query"),
};
