"use strict";

const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const requirePlatformRole = require("../middleware/platformMiddleware");
const controller = require("../controllers/developerEmail.controller");

const router = express.Router();

// Strict security: Only authenticated developers can invoke manual/preview email routes
router.use(verifyToken, requirePlatformRole("developer"));

router.get("/templates", controller.getTemplates);
router.post("/preview", controller.previewTemplate);
router.post("/send", controller.sendTestEmail);
router.post("/run-lifecycle-check", controller.runLifecycleCheck);
router.get("/logs", controller.getEmailLogs);

module.exports = router;
