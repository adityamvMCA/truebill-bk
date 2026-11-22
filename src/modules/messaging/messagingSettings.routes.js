const express = require("express");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");
const MessagingSettings = require("../../models/MessagingSettings");
const { encrypt } = require("../../services/documents/secretBox");
const { callGraph, httpError } = require("../../services/whatsapp.service");

const router = express.Router();
router.use(verifyToken, resolveTenant);

const tid = (req) => req.tenant._id ?? req.tenant.id;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

/* The token is never sent to the browser, only whether one is saved */
router.get("/", async (req, res, next) => {
  try {
    const s = await MessagingSettings.findOne({ tenantId: tid(req) })
      .select("+whatsapp.accessToken")
      .lean();
    if (!s) return res.json({ success: true, settings: null });

    const { accessToken, ...whatsapp } = s.whatsapp || {};
    res.json({
      success: true,
      settings: { ...s, whatsapp: { ...whatsapp, hasToken: Boolean(accessToken) } },
    });
  } catch (e) {
    next(e);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const rates = {};
    for (const ch of ["whatsapp", "email"])
      for (const k of ["invoice", "reminder", "message"])
        rates[`rates.${ch}.${k}`] = num(b.rates?.[ch]?.[k], 0);

    const $set = {
      mode: b.mode === "business" ? "business" : "manual",
      provider: String(b.provider || "meta"),
      businessNumber: String(b.businessNumber || ""),
      ...rates,
    };

    const phoneId = String(b.whatsapp?.phoneNumberId || "").trim();
    const token = String(b.whatsapp?.accessToken || "").trim();

    if (phoneId) $set["whatsapp.phoneNumberId"] = phoneId;

    if (token) {
      if (!phoneId) throw httpError("Phone Number ID is required with the access token");
      // Fail now with Meta's real message instead of at send time
      await callGraph(phoneId, {}, { token, phoneId });
      $set["whatsapp.accessToken"] = encrypt(token);
    }
    // Blank token on save = keep the existing one

    await MessagingSettings.findOneAndUpdate(
      { tenantId: tid(req) },
      { $set },
      { upsert: true },
    );
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
