const express = require("express");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const MessagingSettings = require("../../models/MessagingSettings");

const router = express.Router();
router.use(verifyToken, resolveTenant);

const KINDS = [
  "invoice",
  "eway",
  "delivery",
  "purchaseBill",
  "purchaseReturn",
  "salesReturn",
  "goodsReceipt",
]; // same keys as the frontend KINDS

router.get("/", async (req, res, next) => {
  try {
    const s = await MessagingSettings.findOne({
      tenantId: req.tenant._id ?? req.tenant.id,
    }).lean();
    res.json({ success: true, templates: s?.printTemplates || {} });
  } catch (e) {
    next(e);
  }
});

router.put("/:kind", async (req, res, next) => {
  try {
    const { kind } = req.params;
    const templateId = String(req.body?.templateId || "").trim().slice(0, 50);

    if (!KINDS.includes(kind) || !templateId) {
      return res.status(400).json({ success: false, message: "Invalid kind or templateId" });
    }

    await MessagingSettings.findOneAndUpdate(
      { tenantId: req.tenant._id ?? req.tenant.id },
      { $set: { [`printTemplates.${kind}`]: templateId } },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;