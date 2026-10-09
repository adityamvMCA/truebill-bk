const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    action: { type: String, required: true, index: true },
    module: { type: String, required: true, index: true },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    oldData: { type: mongoose.Schema.Types.Mixed, default: null },
    newData: { type: mongoose.Schema.Types.Mixed, default: null },
    ipAddress: { type: String, default: null },
  },
  { timestamps: true },
);
module.exports = mongoose.model("AuditLog", schema);
