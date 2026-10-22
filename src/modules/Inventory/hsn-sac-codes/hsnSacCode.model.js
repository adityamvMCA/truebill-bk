const mongoose = require("mongoose");

const { Schema } = mongoose;

const hsnSacCodeSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    code: {
      type: String,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 20,
      match: /^[A-Z0-9]{2,20}$/,
      required: true,
      immutable: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    defaultGstRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      required: true,
    },

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
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    autoCreate: false,
    autoIndex: false,
  },
);

hsnSacCodeSchema.index(
  {
    tenantId: 1,
    code: 1,
  },
  {
    unique: true,
  },
);

hsnSacCodeSchema.index({
  tenantId: 1,
  status: 1,
  code: 1,
  _id: 1,
});

module.exports =
  mongoose.models.HsnSacCode || mongoose.model("HsnSacCode", hsnSacCodeSchema);
