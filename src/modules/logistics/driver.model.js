const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const driverSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    driverCode: {
      type: String,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    vehicleType: {
      type: String,
      enum: ["VAN", "TRUCK", "BIKE", "THREE_WHEELER", "CAR"],
      default: "VAN",
    },
    licenseNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"],
      default: "AVAILABLE",
      index: true,
    },
    currentLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      speed: { type: Number, default: 0 },
      heading: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },
    assignedTripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trip",
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

driverSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

driverSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.Driver || mongoose.model("Driver", driverSchema);
