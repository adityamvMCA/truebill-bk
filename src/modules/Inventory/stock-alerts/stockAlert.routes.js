const express = require("express");

const {
  getLowStockProducts,
  getStockSummary,
} = require("./stockAlert.controller");

const Joi = require("joi");

const verifyToken = require("../../../middleware/authMiddleware");

const resolveTenant = require("../../../middleware/tenantMiddleware");

const requirePermission = require("../../../middleware/permissionMiddleware");

const router = express.Router();

const listSchema = Joi.object({
  search: Joi.string().trim().max(100).allow("").default(""),

  category: Joi.string().trim().max(100).allow("", null),

  brand: Joi.string().trim().max(100).allow("", null),

  page: Joi.number().integer().min(1).max(100000).strict().default(1),

  limit: Joi.number().integer().min(1).max(100).strict().default(20),
}).unknown(false);

const validateList = (req, res, next) => {
  const { error, value } = listSchema.validate(req.query ?? {}, {
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

  req.validatedQuery = value;

  return next();
};

router.use(verifyToken, resolveTenant);

router.get("/summary", requirePermission("product.view"), getStockSummary);

router.get(
  "/low-stock",
  requirePermission("product.view"),
  validateList,
  getLowStockProducts,
);

module.exports = router;
