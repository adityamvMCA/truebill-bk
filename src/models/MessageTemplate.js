const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    label: { type: String, required: true },
    name: { type: String, required: true }, // WhatsApp name: lowercase_with_underscores
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    kind: { type: String, enum: ["invoice", "reminder", "message"], required: true },
    language: { type: String, default: "en" },
    category: { type: String, enum: ["UTILITY", "MARKETING"], default: "UTILITY" },
    subject: String, // email only
    body: { type: String, required: true }, // uses {{customerName}} style variables
    variableKeys: [String], // order maps to {{1}}, {{2}} on WhatsApp
    attachPdf: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DRAFT"],
      default: "DRAFT",
    },
    metaTemplateId: String,
    rejectedReason: String,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

schema.index({ tenantId: 1, channel: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("MessageTemplate", schema);