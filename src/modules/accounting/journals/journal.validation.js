const { body } = require("express-validator");

const validateCreateManualJournal = [
  body("postingDate")
    .notEmpty()
    .isISO8601()
    .withMessage("postingDate must be a valid date"),

  body("narration")
    .optional()
    .isString()
    .isLength({ max: 1000 }),

  body("lines")
    .isArray({ min: 2 })
    .withMessage("lines must contain at least two entries"),

  body("lines.*.ledgerId")
    .isMongoId()
    .withMessage("Each line must have a valid ledgerId"),

  body("lines.*.debitPaise")
    .optional()
    .isInt({ min: 0 })
    .withMessage("debitPaise must be a non-negative integer"),

  body("lines.*.creditPaise")
    .optional()
    .isInt({ min: 0 })
    .withMessage("creditPaise must be a non-negative integer"),

  body("lines.*.narration")
    .optional()
    .isString()
    .isLength({ max: 500 }),
];

module.exports = {
  validateCreateManualJournal,
};