const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/);

const compareSchema = Joi.object({
  comparisonMode: Joi.string().valid("RFQ", "DIRECT").required(),

  sourceRfqId: Joi.when("comparisonMode", {
    is: "RFQ",
    then: objectId.required(),
    otherwise: Joi.forbidden(),
  }),

  quotationIds: Joi.when("comparisonMode", {
    is: "DIRECT",

    then: Joi.array()
      .items(objectId.required())
      .min(2)
      .max(20)
      .unique((first, second) => first.toLowerCase() === second.toLowerCase())
      .required(),

    otherwise: Joi.forbidden(),
  }),
}).unknown(false);

const validateCompare = (req, res, next) => {
  const { error, value } = compareSchema.validate(req.body ?? {}, {
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

  req.validatedBody = value;

  return next();
};

module.exports = {
  validateCompare,
};
