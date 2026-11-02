const express = require("express");

const verifyToken = require("../middleware/authMiddleware");
const resolveTenant = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

const c = require("../controllers/share.controller");

const router = express.Router();

router.use(verifyToken, resolveTenant);

router.post("/send", requirePermission("share.send"), c.send);

router.get("/stats", requirePermission("share.view"), c.stats);
router.get("/logs", requirePermission("share.view"), c.logs);

router.get("/settings", requirePermission("share.view"), c.getSettings);
router.put("/settings", requirePermission("share.settings.manage"), c.saveSettings);

router.get("/templates", requirePermission("share.view"), c.listTemplates);
router.post("/templates", requirePermission("share.templates.manage"), c.createTemplate);
router.post("/templates/preview", requirePermission("share.view"), c.previewTemplate);
router.post("/templates/:id/sync", requirePermission("share.templates.manage"), c.syncTemplate);
router.delete("/templates/:id", requirePermission("share.templates.manage"), c.deleteTemplate);

module.exports = router;