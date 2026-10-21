const mongoose = require("mongoose");

const { Schema } = mongoose;

const STATUSES = ["CREATED", "APPROVED", "REJECTED", "CANCELLED"];

const optionalText = (maxlength) => ({
  type: String,
  trim: true,
  maxlength,
  default: null,
});

const userReference = (required = false) => ({
  type: Schema.Types.ObjectId,
  ref: "User",
  required,
  ...(required ? {} : { default: null }),
});

const itemSchema = new Schema(
  {
    lineId: {
      type: Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    productCode: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },

    productName: {
      type: String,
      trim: true,
      maxlength: 200,
      required: true,
    },

    productType: {
      type: String,
      enum: ["GOODS", "SERVICE"],
      required: true,
    },

    unit: {
      type: String,
      trim: true,
      uppercase: true,
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0.001,
      max: 1000000,
      validate: {
        validator: (value) => {
          const scaled = value * 1000;

          return (
            Number.isFinite(value) &&
            Number.isSafeInteger(Math.round(scaled)) &&
            Math.abs(scaled - Math.round(scaled)) <= 0.000001
          );
        },
        message: "Quantity must have at most three decimal places",
      },
    },

    specification: optionalText(1000),
  },
  { _id: false },
);

const purchaseRequisitionSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    requisitionNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    requisitionDate: {
      type: Date,
      required: true,
    },

    requiredByDate: {
      type: Date,
      default: null,
    },

    department: optionalText(100),

    purpose: {
      type: String,
      trim: true,
      maxlength: 1000,
      required: true,
    },

    priority: {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
      required: true,
    },

    items: {
      type: [itemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,
        message: "A requisition requires between 1 and 200 items",
      },
    },

    notes: optionalText(2000),

    status: {
      type: String,
      enum: STATUSES,
      default: "CREATED",
      required: true,
    },

    approvedAt: { type: Date, default: null },
    approvedBy: userReference(),

    rejectedAt: { type: Date, default: null },
    rejectedBy: userReference(),
    rejectionReason: optionalText(1000),

    cancelledAt: { type: Date, default: null },
    cancelledBy: userReference(),
    cancellationReason: optionalText(1000),

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: userReference(),

    createdBy: userReference(true),
    updatedBy: userReference(true),
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    autoCreate: false,
    autoIndex: false,
  },
);

purchaseRequisitionSchema.index(
  { tenantId: 1, requisitionNumber: 1 },
  { unique: true },
);

purchaseRequisitionSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  requisitionDate: -1,
  _id: -1,
});

purchaseRequisitionSchema.index({
  tenantId: 1,
  createdBy: 1,
  requisitionDate: -1,
});

purchaseRequisitionSchema.pre("validate", function () {
  if (
    this.requiredByDate &&
    this.requisitionDate &&
    this.requiredByDate < this.requisitionDate
  ) {
    this.invalidate(
      "requiredByDate",
      "Required-by date cannot precede requisition date",
    );
  }

  const lineIds = (this.items || []).map((item) => String(item.lineId));

  if (new Set(lineIds).size !== lineIds.length) {
    this.invalidate("items", "Each lineId must be unique");
  }

  const details = {
    APPROVED: ["approvedAt", "approvedBy"],
    REJECTED: ["rejectedAt", "rejectedBy", "rejectionReason"],
    CANCELLED: ["cancelledAt", "cancelledBy", "cancellationReason"],
  };

  for (const field of details[this.status] || []) {
    if (!this[field]) {
      this.invalidate(field, `${field} is required for ${this.status}`);
    }
  }

  if (
    this.isDeleted &&
    (this.status !== "CREATED" || !this.deletedAt || !this.deletedBy)
  ) {
    this.invalidate(
      "isDeleted",
      "Only CREATED requisitions can be deleted, with deletion details",
    );
  }
});

module.exports =
  mongoose.models.PurchaseRequisition ||
  mongoose.model("PurchaseRequisition", purchaseRequisitionSchema);
