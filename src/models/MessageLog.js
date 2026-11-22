const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    channel: { type: String, enum: ["whatsapp", "email"], required: true },
    kind: { type: String, enum: ["invoice", "reminder", "message"], required: true },
    mode: { type: String, enum: ["manual", "business"], default: "business" },
    to: String,
    customerName: String,
    customerCode: String,
    invoiceNumber: String, // holds the document number for every document type
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed"],
      default: "queued",
    },
    providerMessageId: { type: String, index: true },
    billable: Boolean,
    pricingCategory: String,
    costPaise: { type: Number, default: 0 },
    error: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

schema.index({ tenantId: 1, channel: 1, kind: 1, invoiceNumber: 1 });

module.exports = mongoose.models.MessageLog || mongoose.model("MessageLog", schema);