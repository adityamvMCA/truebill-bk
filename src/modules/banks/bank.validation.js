const Joi = require("joi");

const editable = {
  accountName: Joi.string().trim().max(150).required(),
  bankName: Joi.string().trim().max(150).required(),
  accountHolderName: Joi.string().trim().max(150).required(),
  accountType: Joi.string().valid("CURRENT", "SAVINGS").required(),
  branchName: Joi.string().trim().max(150).required(),
  ifscCode: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .required()
    .messages({
      "string.pattern.base": "IFSC must be 11 characters, e.g. ABCD0123456",
    }),
  status: Joi.string().valid("ACTIVE", "INACTIVE").default("ACTIVE"),
  notes: Joi.string().trim().max(1000).allow("", null),
};

const accountNumber = Joi.string()
  .trim()
  .pattern(/^\d{6,30}$/)
  .required()
  .messages({ "string.pattern.base": "Account number must be 6-30 digits" });

const createSchema = Joi.object({
  ...editable,
  accountNumber,
  openingBalance: Joi.number()
    .min(0)
    .max(1000000000)
    .precision(2)
    .strict()
    .default(0),
}).unknown(false);

const updateSchema = Joi.object(editable).unknown(false);

const paramsSchema = Joi.object({
  bankCode: Joi.string().trim().uppercase().max(50).required(),
}).unknown(false);

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),
  status: Joi.string().valid("ACTIVE", "INACTIVE"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
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
  validateCreateBank: validate(createSchema),
  validateUpdateBank: validate(updateSchema),
  validateBankParams: validate(paramsSchema, "params"),
  validateListBanks: validate(listSchema, "query"),
};
