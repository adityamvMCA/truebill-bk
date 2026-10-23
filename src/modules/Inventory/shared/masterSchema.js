const mongoose = require("mongoose");

module.exports = ({ modelName, codeField, legacyCode = false }) => {
  const { Schema } = mongoose;
  const schema = new Schema(
    {
      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        immutable: true,
      },
      [codeField]: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 100,
        required: !legacyCode,
        immutable: true,
      },
      name: { type: String, trim: true, maxlength: 100, required: true },
      normalizedName: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 100,
        required: true,
      },
      seedKey: { type: String, trim: true, maxlength: 100, immutable: true },
      description: { type: String, trim: true, maxlength: 1000, default: null },
      status: {
        type: String,
        enum: ["ACTIVE", "INACTIVE"],
        default: "ACTIVE",
        required: true,
      },
      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        immutable: true,
      },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    {
      timestamps: true,
      optimisticConcurrency: true,
      autoCreate: false,
      autoIndex: false,
    },
  );
  const codeOptions = legacyCode
    ? {
        unique: true,
        partialFilterExpression: { [codeField]: { $type: "string" } },
      }
    : { unique: true };
  schema.index({ tenantId: 1, [codeField]: 1 }, codeOptions);
  schema.index({ tenantId: 1, normalizedName: 1 }, { unique: true });
  schema.index(
    { tenantId: 1, seedKey: 1 },
    {
      unique: true,
      partialFilterExpression: { seedKey: { $type: "string" } },
    },
  );
  schema.index({ tenantId: 1, status: 1, name: 1, _id: 1 });
  schema.pre("validate", function () {
    this.name = String(this.name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    this.normalizedName = this.name.toLowerCase();
  });
  return mongoose.models[modelName] || mongoose.model(modelName, schema);
};
