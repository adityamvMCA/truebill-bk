const Joi = require("joi");

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GST_RATES = [0, 3, 5, 12, 18, 28];

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .messages({ "string.pattern.base": "{{#label}} must be a valid ObjectId" });

const optionalText = (max) => Joi.string().trim().max(max).allow("", null);

const newSupplier = Joi.object({
  supplierName: Joi.string().trim().min(2).max(150).required(),
  gstNo: Joi.string()
    .trim()
    .uppercase()
    .pattern(GSTIN)
    .allow("", null)
    .messages({ "string.pattern.base": "Supplier GSTIN is not valid" }),
  phone: optionalText(20),
  email: optionalText(120),
  billingAddress: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(10),
  paymentTerms: optionalText(100),
  creditDays: Joi.number().integer().min(0).max(365),
}).unknown(false);

const supplierRef = Joi.object({
  mode: Joi.string().valid("EXISTING", "NEW").required(),
  supplierId: objectId.when("mode", { is: "EXISTING", then: Joi.required(), otherwise: Joi.forbidden() }),
  data: newSupplier.when("mode", { is: "NEW", then: Joi.required(), otherwise: Joi.forbidden() }),
}).unknown(false);

const newProduct = Joi.object({
  name: Joi.string().trim().min(2).max(200).required(),
  unit: Joi.string().trim().uppercase().pattern(/^[A-Z][A-Z0-9_]{0,19}$/).default("NOS"),
  type: Joi.string().valid("GOODS", "SERVICE").default("GOODS"),
  hsnSacCode: Joi.string().trim().uppercase().pattern(/^[A-Z0-9]{2,20}$/).allow("", null),
  gstRate: Joi.number().valid(...GST_RATES).strict().default(0),
  purchasePrice: Joi.number().min(0).max(1000000000).precision(2).strict().default(0),
}).unknown(false);

const productRef = Joi.object({
  mode: Joi.string().valid("EXISTING", "NEW").required(),
  productId: objectId.when("mode", { is: "EXISTING", then: Joi.required(), otherwise: Joi.forbidden() }),
  data: newProduct.when("mode", { is: "NEW", then: Joi.required(), otherwise: Joi.forbidden() }),
}).unknown(false);

const item = Joi.object({
  product: productRef.required(),
  quantity: Joi.number().min(0.001).max(1000000).precision(3).strict().required(),
  unitRate: Joi.number().min(0).max(1000000000).precision(2).strict().required(),
  discountPercent: Joi.number().min(0).max(100).precision(2).strict().default(0),
  gstRate: Joi.number().valid(...GST_RATES).strict().required(),
  taxCreditEligible: Joi.boolean().strict().default(false),
}).unknown(false);

const confirmScanSchema = Joi.object({
  supplier: supplierRef.required(),
  supplierInvoiceNumber: Joi.string().trim().max(100).required(),
  billDate: Joi.date().iso().required(),
  dueDate: Joi.date().iso().min(Joi.ref("billDate")).required().messages({
    "date.min": "Due date cannot be before bill date",
  }),
  paymentTerms: Joi.string().trim().max(100).default("Due on Receipt"),
  taxMode: Joi.string().valid("NONE", "INTRASTATE", "INTERSTATE", "INTRA_STATE", "INTER_STATE").required(),
  updateStock: Joi.boolean().strict().default(false),
  items: Joi.array().items(item).min(1).max(200).required(),
  notes: optionalText(1000),
}).unknown(false);

const validateConfirmScan = (req, res, next) => {
  const { error, value } = confirmScanSchema.validate(req.body ?? {}, {
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

  req.body = value;
  return next();
};

module.exports = { validateConfirmScan };
