
const { body } = require("express-validator");

const money = (field) =>
  body(field)
    .isInt({ min: 1 })
    .withMessage(`${field} must be a positive integer in paise`)
    .toInt();

const validateNature = [
  body("section")
    .isString()
    .withMessage("Section must be text")
    .trim()
    .notEmpty()
    .withMessage("Section is required"),

  body("name")
    .isString()
    .withMessage("Name must be text")
    .trim()
    .notEmpty()
    .withMessage("Nature name is required"),

  body("rates")
    .isArray({ min: 1 })
    .withMessage("At least one TDS rate is required"),

  body("rates.*.deducteeType")
    .isIn(["INDIVIDUAL_HUF", "COMPANY", "FIRM", "OTHER", "ALL"])
    .withMessage("Invalid deductee type"),

  body("rates.*.withPanPercent")
    .isFloat({ min: 0, max: 100 })
    .withMessage("With-PAN rate must be between 0 and 100")
    .toFloat(),

  body("rates.*.withoutPanPercent")
    .isFloat({ min: 0, max: 100 })
    .withMessage("Without-PAN rate must be between 0 and 100")
    .toFloat(),

  body("singleThresholdPaise")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Single threshold must be a non-negative integer in paise")
    .toInt(),

  body("annualThresholdPaise")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Annual threshold must be a non-negative integer in paise")
    .toInt(),

  body("effectiveFrom")
    .isISO8601()
    .withMessage("A valid effective-from date is required"),

  body("effectiveTo")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("Effective-to must be a valid date"),

  body("tdsLedgerId")
    .isMongoId()
    .withMessage("A valid TDS ledger is required"),
];

const deductionBase = [
  body("natureId")
    .isMongoId()
    .withMessage("Select a valid TDS nature"),

  body("partyLedgerId")
    .isMongoId()
    .withMessage("Select a valid supplier ledger"),

  body("deducteeType")
    .isIn(["INDIVIDUAL_HUF", "COMPANY", "FIRM", "OTHER"])
    .withMessage("Select a valid deductee type"),

  body("pan")
    .optional({ nullable: true })
    .isString()
    .withMessage("PAN must be text"),

  body("date")
    .isISO8601()
    .withMessage("A valid deduction date is required"),

  money("baseAmountPaise"),

  body("originalDocNumber")
    .optional({ nullable: true })
    .isString()
    .withMessage("Original bill number must be text"),

  body("originalDocDate")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("Original bill date must be valid"),

  body("certificate")
    .optional({ nullable: true })
    .isObject()
    .withMessage("Certificate must be an object"),

  body("certificate.number")
    .if(body("certificate").exists({ checkNull: false }))
    .optional({ nullable: true })
    .isString()
    .withMessage("Certificate number must be text"),

  body("certificate.ratePercent")
    .if(body("certificate").exists({ checkNull: false }))
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100 })
    .withMessage("Certificate rate must be between 0 and 100")
    .toFloat(),
];

module.exports = {
  validateNature,

  validatePreview: [...deductionBase],

  validateDeduct: [
    ...deductionBase,
    body("partyName")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Supplier name is required"),
  ],

  validateChallan: [
    body("deductionIds")
      .isArray({ min: 1 })
      .withMessage("Select at least one TDS deduction"),

    body("deductionIds.*")
      .isMongoId()
      .withMessage("Invalid deduction ID"),

    body("bankLedgerId")
      .isMongoId()
      .withMessage("Select a valid bank ledger"),

    body("bsrCode")
      .matches(/^\d{7}$/)
      .withMessage("BSR code must be 7 digits"),

    body("challanSerialNo")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Challan serial number is required"),

    body("depositDate")
      .isISO8601()
      .withMessage("A valid deposit date is required"),
  ],
};
