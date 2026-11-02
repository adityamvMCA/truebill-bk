const express = require("express");

const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");
const share = require("../controllers/share.controller");

const router = express.Router();

// resolveTenant is REQUIRED: share.controller reads req.tenant to open
// the tenant's own database for invoices.
router.use(verifyToken, resolveTenant);

router.post("/send", share.send);
router.get("/stats", share.stats);
router.get("/logs", share.logs);

router.get("/settings", share.getSettings);
router.put("/settings", share.saveSettings);

router.get("/templates", share.listTemplates);
router.post("/templates", share.createTemplate);
router.post("/templates/preview", share.previewTemplate);
router.post("/templates/:id/sync", share.syncTemplate);
router.delete("/templates/:id", share.deleteTemplate);

module.exports = router;