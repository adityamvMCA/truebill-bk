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

module.exports = router;