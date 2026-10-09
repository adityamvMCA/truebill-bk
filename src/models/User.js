const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    username: { type: String, lowercase: true, trim: true, sparse: true },
    platformRole: {
      type: String,
      enum: ["developer", "support", "tenant"],
      default: "tenant",
      index: true,
    },
    role: { type: String, default: "admin", index: true },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    clientCode: { type: String, default: null, index: true },
    developerCode: { type: String, default: null, index: true },
    permissions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);
schema.index({ email: 1 }, { unique: true });
schema.index({ username: 1 }, { unique: true, sparse: true });
schema.index({ tenantId: 1, email: 1 });
module.exports = mongoose.model("User", schema);
