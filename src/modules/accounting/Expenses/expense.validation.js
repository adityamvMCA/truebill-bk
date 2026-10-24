const { body, param, query, validationResult } = require("express-validator");

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  return next();
};

const METHODS = ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD"];
const STATUSES = ["NEW", "APPROVED", "REJECTED", "CANCELLED"];

const upper = (value) => String(value || "").toUpperCase();

const validateCreateExpense = [
  body("requestId").isUUID(4).withMessage("requestId must be a UUID v4"),

  body("expenseDate").isISO8601().withMessage("expenseDate must be a valid date"),

  body("paymentMode")
    .customSanitizer(upper)
    .isIn(["PAID", "PAYABLE"])
    .withMessage("paymentMode must be PAID or PAYABLE"),

  body("paymentMethod")
    .if(body("paymentMode").customSanitizer(upper).equals("PAID"))
    .customSanitizer(upper)
    .isIn(METHODS)
    .withMessage(`paymentMethod must be one of: ${METHODS.join(", ")}`),

  body("paymentLedgerId")
    .if(body("paymentMode").customSanitizer(upper).equals("PAID"))
    .isMongoId()
    .withMessage("Select a cash or bank ledger"),

  body("supplierId")
    .if(body("paymentMode").customSanitizer(upper).equals("PAYABLE"))
    .isMongoId()
    .withMessage("Select a supplier for a pay-later expense"),

  body("taxMode")
    .optional()
    .customSanitizer(upper)
    .isIn(["NONE", "GST"])
    .withMessage("taxMode must be NONE or GST"),

  body("inputGstLedgerId")
    .optional({ nullable: true, checkFalsy: true })
    .isMongoId()
    .withMessage("inputGstLedgerId is invalid"),

  body("payeeName")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 150 })
    .withMessage("payeeName cannot exceed 150 characters"),

  body("referenceNumber")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 100 })
    .withMessage("referenceNumber cannot exceed 100 characters"),

  body("notes")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 })
    .withMessage("notes cannot exceed 1000 characters"),

  body("lines")
    .isArray({ min: 1, max: 100 })
    .withMessage("lines must contain between 1 and 100 entries"),

  body("lines.*.expenseLedgerId")
    .isMongoId()
    .withMessage("Each line needs a valid expense account"),

  body("lines.*.description")
    .isString()
    .trim()
    .isLength({ min: 1, max: 300 })
    .withMessage("Each line needs a description (max 300 characters)"),

  body("lines.*.amount")
    .isFloat({ gt: 0 })
    .withMessage("Each line amount must be greater than 0"),

  body("lines.*.gstRate")
    .optional()
    .isIn([0, 5, 12, 18, 28])
    .withMessage("Invalid GST rate"),

  handleValidation,
];

const validateExpenseParams = [
  param("expenseNumber").trim().notEmpty().withMessage("expenseNumber is required"),
  handleValidation,
];

const validateRejectExpense = [
  param("expenseNumber").trim().notEmpty().withMessage("expenseNumber is required"),
  body("reason")
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("A rejection reason (max 500 characters) is required"),
  handleValidation,
];

const validateListExpenses = [
  query("status")
    .optional()
    .customSanitizer(upper)
    .isIn(STATUSES)
    .withMessage("Invalid status"),
  query("paymentMode")
    .optional()
    .customSanitizer(upper)
    .isIn(["PAID", "PAYABLE"])
    .withMessage("Invalid paymentMode"),
  query("fromDate").optional().isISO8601().withMessage("fromDate is invalid"),
  query("toDate").optional().isISO8601().withMessage("toDate is invalid"),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  handleValidation,
];

module.exports = {
  validateCreateExpense,
  validateExpenseParams,
  validateRejectExpense,
  validateListExpenses,
};
