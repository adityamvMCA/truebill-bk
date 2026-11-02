const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    invoiceId: mongoose.Schema.Types.ObjectId,
    invoiceNumber: String,
    customerCode: String,
    customerName: String,
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    kind: { type: String, enum: ["invoice", "reminder", "message"], required: true },
    mode: { type: String, enum: ["manual", "business"], default: "business" },
    to: String,
    subject: String,
    templateName: String,
    providerMessageId: { type: String, index: true },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed"],
      default: "queued",
    },
    error: String,
    billable: { type: Boolean, default: true },
    pricingCategory: String,
    costPaise: { type: Number, default: 0 },
    sentBy: mongoose.Schema.Types.ObjectId,
  },
  { timestamps: true },
);

schema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model("MessageLog", schema);