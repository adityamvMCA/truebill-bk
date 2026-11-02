const mongoose = require("mongoose");

const rate = { invoice: { type: Number, default: 0 }, reminder: { type: Number, default: 0 }, message: { type: Number, default: 0 } };

module.exports = mongoose.model(
  "MessagingSettings",
  new mongoose.Schema(
    {
      tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
      mode: { type: String, enum: ["manual", "business"], default: "manual" },
      provider: { type: String, default: "meta" },
      businessNumber: String,
      rates: {
        whatsapp: { ...rate, invoice: { type: Number, default: 0.12 }, reminder: { type: Number, default: 0.12 } },
        email: rate,
      },
    },
    { timestamps: true },
  ),
);