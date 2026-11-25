const mongoose = require("mongoose");
const crypto = require("crypto");

const breadcrumbSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    speed: { type: Number, default: 0 },
    heading: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const tripSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    tripNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true,
    },
    driverName: { type: String, default: "" },
    driverPhone: { type: String, default: "" },
    vehicleNumber: { type: String, default: "" },
    vehicleType: { type: String, default: "VAN" },

    deliveryNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryNote",
      default: null,
    },
    deliveryNoteNumber: { type: String, default: "" },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesInvoice",
      default: null,
    },
    invoiceNumber: { type: String, default: "" },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
      default: "",
    },

    origin: {
      address: { type: String, default: "Warehouse / Store" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    destination: {
      address: { type: String, required: true },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    status: {
      type: String,
      enum: ["SCHEDULED", "STARTED", "PAUSED", "COMPLETED", "CANCELLED"],
      default: "SCHEDULED",
      index: true,
    },

    trackingToken: {
      type: String,
      unique: true,
      index: true,
      default: () => crypto.randomBytes(16).toString("hex"),
    },

    currentLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      speed: { type: Number, default: 0 },
      heading: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },

    path: [breadcrumbSchema],

    distanceCoveredKm: { type: Number, default: 0 },
    estimatedDistanceKm: { type: Number, default: 0 },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    notes: { type: String, default: "" },

    receiverProof: {
      signedBy: { type: String, default: "" },
      notes: { type: String, default: "" },
      signatureImage: { type: String, default: "" },
      deliveredAt: { type: Date, default: null },
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

tripSchema.index({ tenantId: 1, status: 1 });
tripSchema.index({ tenantId: 1, tripNumber: 1 });

module.exports = mongoose.models.Trip || mongoose.model("Trip", tripSchema);
