const Joi = require("joi");

const querySchema = Joi.object({
  view: Joi.string().valid("party", "document").default("party"),

  partyId: Joi.string()
    .trim()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .messages({
      "string.pattern.base": "partyId must be a valid ObjectId",
    }),

  search: Joi.string().trim().max(100).allow("").default(""),

  asOfDate: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .messages({
      "string.pattern.base": "asOfDate must use YYYY-MM-DD",
    }),

  overdueOnly: Joi.boolean().default(false),

  page: Joi.number().integer().min(1).default(1),

  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);

const validateOutstandingQuery = (req, res, next) => {
  const { error, value } = querySchema.validate(req.query, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.details.map((detail) => detail.message),
    });
  }

  req.validatedQuery = value;
  next();
};

module.exports = {
  validateOutstandingQuery,
};