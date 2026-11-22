const express = require("express");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const c = require("./transporter.controller");
const v = require("./transporter.validation");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.get(
  "/",
  v.validateListTransporters,
  c.getTransporters,
);

router.post(
  "/",
  v.validateCreateTransporter,
  c.createTransporter,
);

router.get(
  "/:id",
  v.validateTransporterParams,
  c.getTransporterById,
);

router.put(
  "/:id",
  v.validateTransporterParams,
  v.validateUpdateTransporter,
  c.updateTransporter,
);

router.delete(
  "/:id",
  v.validateTransporterParams,
  c.deleteTransporter,
);

module.exports = router;
