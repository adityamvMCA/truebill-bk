const mongoose = require("mongoose");

const { Schema } = mongoose;

const {
  TRANSPORT_MODES,
  VEHICLE_TYPES,
  CANCEL_REASONS,
  EWB_NUMBER_REGEX,
} = require("./ewayBill.rules");

const optionalText = (maxlength) => ({
  type: String,
  trim: true,
  maxlength,
  default: null,
});

const historySchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "DETAILS_SAVED",
        "GENERATED",
        "VEHICLE_UPDATED",
        "VALIDITY_EXTENDED",
        "CANCELLED",
      ],
      required: true,
    },

    at: {
      type: Date,
      required: true,
    },

    by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    data: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false },
);

const ewayBillSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["NOT_GENERATED", "GENERATED", "CANCELLED"],
      default: "NOT_GENERATED",
    },

    // MANUAL: generated on the government portal and recorded here.
    // GSP: reserved for a future API provider.
    source: {
      type: String,
      enum: ["MANUAL", "GSP"],
      default: "MANUAL",
    },

    ewbNumber: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator: (value) => value == null || EWB_NUMBER_REGEX.test(value),
        message: "E-way bill number must be 12 digits",
      },
    },

    ewbDate: { type: Date, default: null },
    validUntil: { type: Date, default: null },

    /* ---------- Transport details ---------- */

    distanceKm: { type: Number, min: 1, max: 4000, default: null },

    transportMode: {
      type: String,
      enum: TRANSPORT_MODES,
      default: "ROAD",
    },

    vehicleType: {
      type: String,
      enum: VEHICLE_TYPES,
      default: "REGULAR",
    },

    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
      default: null,
    },

    transporterId: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 15,
      default: null,
    },

    transporterName: optionalText(200),
    transportDocNumber: optionalText(100),
    transportDocDate: { type: Date, default: null },

    /* ---------- Dispatch / delivery ---------- */

    fromPlace: optionalText(50),
    fromPincode: optionalText(6),
    fromStateCode: optionalText(2),

    toPlace: optionalText(50),
    toPincode: optionalText(6),
    toStateCode: optionalText(2),

    /* ---------- Cancellation ---------- */

    cancelledAt: { type: Date, default: null },

    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancelReason: {
      type: String,
      enum: [...CANCEL_REASONS, null],
      default: null,
    },

    cancelRemarks: optionalText(500),

    history: {
      type: [historySchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 200,
        message: "E-way bill history is too long",
      },
    },
  },
  { _id: false },
);

module.exports = { ewayBillSchema };
