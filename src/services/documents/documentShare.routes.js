const express = require("express");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const { getDocumentType } = require("./registry");
const { shareDocumentOnWhatsApp } = require("./documentShare.service");

const router = express.Router();
router.use(verifyToken, resolveTenant);

/* POST /documents/:docType/:ref/whatsapp   body: { phone?, force? } */
router.post(
  "/:docType/:ref/whatsapp",
  (req, res, next) => {
    try {
      return requirePermission(getDocumentType(req.params.docType).permission)(req, res, next);
    } catch (error) {
      return next(error);
    }
  },
  async (req, res, next) => {
    try {
      const ref = String(req.params.ref || "").trim();
      if (!ref || ref.length > 100) {
        return res.status(400).json({ success: false, message: "Invalid document reference" });
      }

      const result = await shareDocumentOnWhatsApp({
        tenant: req.tenant,
        userId: req.user.userId,
        docType: req.params.docType,
        ref,
        phone: req.body?.phone ? String(req.body.phone) : undefined,
        force: req.body?.force === true,
      });

      res.json({ success: true, message: "Sent on WhatsApp", ...result });
    } catch (error) {
      next(error);
    }
  },
);

/* GET /documents/:docType/:ref/link */
router.get("/:docType/:ref/link", async (req, res, next) => {
  try {
    const { createDocToken } = require("./documentToken");
    const ref = String(req.params.ref || "").trim();
    const token = createDocToken({
      tenantId: req.tenant._id || req.tenant.id,
      docType: req.params.docType,
      ref,
      ttlMinutes: 90 * 24 * 60,
    });
    const frontendBase = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const url = `${frontendBase}/print/${req.params.docType}/${encodeURIComponent(token)}`;

    return res.json({ success: true, url, token });
  } catch (error) {
    next(error);
  }
});

module.exports = router;