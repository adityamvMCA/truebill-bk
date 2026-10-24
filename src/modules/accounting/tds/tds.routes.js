const express = require("express");
const verifyToken = require("../../../middleware/authMiddleware");
const resolveTenant = require("../../../middleware/tenantMiddleware");
const requirePermission = require("../../../middleware/permissionMiddleware");
const c = require("./tds.controller");
const v = require("./tds.validation");

const router = express.Router();
router.use(verifyToken, resolveTenant);

router.get("/natures", requirePermission("ledger.view"), c.listNatures);
router.post("/natures", requirePermission("ledger.create"), v.validateNature, c.createNature);

router.post("/preview", requirePermission("ledger.view"), v.validatePreview, c.preview);
router.post("/deductions", requirePermission("ledger.create"), v.validateDeduct, c.deduct);
router.post("/challans", requirePermission("ledger.create"), v.validateChallan, c.payChallan);
router.get("/register", requirePermission("ledger.view"), c.register);

module.exports = router;
