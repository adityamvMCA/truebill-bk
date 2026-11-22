const mongoose = require("mongoose");

const transporterSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    transporterId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    transporterName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    transportMode: {
      type: String,
      enum: ["ROAD", "RAIL", "AIR", "SHIP"],
      default: "ROAD",
    },
    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
      default: "",
    },
    vehicleType: {
      type: String,
      enum: ["REGULAR", "ODC"],
      default: "REGULAR",
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 100,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },
    state: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },
    pincode: {
      type: String,
      trim: true,
      maxlength: 10,
      default: "",
    },
    distanceKm: {
      type: Number,
      min: 0,
      max: 4000,
      default: 0,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

transporterSchema.index({ tenantId: 1, isDeleted: 1, status: 1 });
transporterSchema.index({ tenantId: 1, transporterName: 1 });
transporterSchema.index({ tenantId: 1, transporterId: 1 });

module.exports =
  mongoose.models.Transporter ||
  mongoose.model("Transporter", transporterSchema);
