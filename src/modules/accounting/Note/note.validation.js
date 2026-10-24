const { body } = require("express-validator");

// Shape checks only. Money, GST and ledger rules are enforced in note.service.js.
const validateCreateNote = [
  body("requestId")
    .optional()
    .isUUID(4)
    .withMessage("requestId must be a UUID v4"),
  body("noteType")
    .isIn(["CREDIT_NOTE", "DEBIT_NOTE"])
    .withMessage("noteType is invalid"),
  body("partyType")
    .isIn(["CUSTOMER", "SUPPLIER"])
    .withMessage("partyType is invalid"),
  body("partyName").isString().trim().notEmpty().isLength({ max: 200 }),
  body("partyLedgerId")
    .isMongoId()
    .withMessage("partyLedgerId must be a valid id"),
  body("adjustmentLedgerId")
    .isMongoId()
    .withMessage("adjustmentLedgerId must be a valid id"),
  body("noteDate").isISO8601().withMessage("noteDate must be a valid date"),
  body("reason").isString().notEmpty(),
  body("isInterState").optional().isBoolean(),
  body("originalDocNumber")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 50 }),
  body("originalDocDate")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601(),
  body("narration")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 }),
  body("lines")
    .isArray({ min: 1, max: 200 })
    .withMessage("lines must contain at least one entry"),
  body("lines.*.description")
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 300 }),
  body("lines.*.taxablePaise")
    .isInt({ min: 1 })
    .withMessage("taxablePaise must be a positive integer")
    .toInt(),
  body("lines.*.gstRate").isFloat({ min: 0, max: 28 }),
];

module.exports = { validateCreateNote };
