const { body } = require("express-validator");

const money = (f) => body(f).isInt({ min: 1 }).withMessage(`${f} must be a positive integer (paise)`).toInt();

const validateNature = [
  body("section").isString().trim().notEmpty(),
  body("name").isString().trim().notEmpty(),
  body("rates").isArray({ min: 1 }),
  body("rates.*.deducteeType").isIn(["INDIVIDUAL_HUF", "COMPANY", "FIRM", "OTHER", "ALL"]),
  body("rates.*.withPanPercent").isFloat({ min: 0, max: 100 }),
  body("rates.*.withoutPanPercent").isFloat({ min: 0, max: 100 }),
  body("singleThresholdPaise").optional().isInt({ min: 0 }).toInt(),
  body("annualThresholdPaise").optional().isInt({ min: 0 }).toInt(),
  body("effectiveFrom").isISO8601(),
  body("effectiveTo").optional({ nullable: true }).isISO8601(),
  body("tdsLedgerId").isMongoId(),
];

const deductionBase = [
  body("natureId").isMongoId(),
  body("partyLedgerId").isMongoId(),
  body("deducteeType").isString().notEmpty(),
  body("pan").optional({ nullable: true }).isString(),
  body("date").isISO8601(),
  money("baseAmountPaise"),
  body("certificate").optional({ nullable: true }).isObject(),
];

module.exports = {
  validateNature,
  validatePreview: deductionBase,
  validateDeduct: [...deductionBase, body("partyName").isString().trim().notEmpty()],
  validateChallan: [
    body("deductionIds").isArray({ min: 1 }),
    body("deductionIds.*").isMongoId(),
    body("bankLedgerId").isMongoId(),
    body("bsrCode").matches(/^\d{7}$/).withMessage("BSR code must be 7 digits"),
    body("challanSerialNo").isString().trim().notEmpty(),
    body("depositDate").isISO8601(),
  ],
};
