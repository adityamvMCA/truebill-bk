const mongoose = require("mongoose");

const { Schema } = mongoose;

const CREATION_MODES = ["DIRECT", "REQUISITION"];

const RFQ_STATUSES = ["CREATED", "ISSUED", "CLOSED", "CANCELLED"];

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

const isRequisitionBased = function () {
  return this.creationMode === "REQUISITION";
};

const quantityIsValid = (value) => {
  if (!Number.isFinite(value)) {
    return false;
  }

  const scaled = value * 1000;
  const rounded = Math.round(scaled);

  return (
    Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) <= 0.000001
  );
};

/* ==========================================
   RFQ ITEMS
   ========================================== */

const itemSchema = new Schema(
  {
    lineId: {
      type: Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
    },

    // Required by document validation only when
    // creationMode is REQUISITION.
    requisitionLineId: {
      type: Schema.Types.ObjectId,
      default: null,
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
      min: 0.001,
      max: 1000000,
      required: true,

      validate: {
        validator: quantityIsValid,
        message: "Quantity must have at most three decimal places",
      },
    },

    specification: optionalText(1000),
  },
  {
    _id: false,
  },
);

/* ==========================================
   RFQ DOCUMENT
   ========================================== */

const purchaseRfqSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    rfqNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    creationMode: {
      type: String,
      enum: CREATION_MODES,
      required: true,
      immutable: true,
    },

    rfqDate: {
      type: Date,
      required: true,
    },

    quotationDueDate: {
      type: Date,
      required: true,
    },

    sourceRequisitionId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseRequisition",
      default: null,
      required: isRequisitionBased,
      immutable: true,
    },

    sourceRequisitionNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: null,
      required: isRequisitionBased,
      immutable: true,
    },

    sourceRequisitionVersion: {
      type: Number,
      min: 0,
      default: null,
      required: isRequisitionBased,
      immutable: true,

      validate: {
        validator: (value) => value === null || Number.isSafeInteger(value),

        message:
          "Source requisition version must be a non-negative safe integer",
      },
    },

    supplierIds: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "Supplier",
        },
      ],

      required: true,

      validate: {
        validator: (ids) =>
          Array.isArray(ids) &&
          ids.length >= 1 &&
          ids.length <= 100 &&
          new Set(ids.map(String)).size === ids.length,

        message: "Provide between 1 and 100 unique suppliers",
      },
    },

    items: {
      type: [itemSchema],
      required: true,

      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,

        message: "An RFQ requires between 1 and 200 items",
      },
    },

    deliveryAddress: optionalText(2000),
    paymentTerms: optionalText(100),
    deliveryTerms: optionalText(1000),
    termsAndConditions: optionalText(5000),
    notes: optionalText(2000),

    status: {
      type: String,
      enum: RFQ_STATUSES,
      default: "CREATED",
      required: true,
    },

    // REQUISITION RFQs reserve their source while
    // CREATED, ISSUED, or CLOSED.
    // DIRECT RFQs never reserve a requisition.
    reservesSource: {
      type: Boolean,
      required: true,

      default: function () {
        return (
          this.creationMode === "REQUISITION" &&
          !this.isDeleted &&
          this.status !== "CANCELLED"
        );
      },
    },

    issuedAt: {
      type: Date,
      default: null,
    },

    issuedBy: userReference(),

    closedAt: {
      type: Date,
      default: null,
    },

    closedBy: userReference(),

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelledBy: userReference(),

    cancellationReason: optionalText(1000),

    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

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

/* ==========================================
   INDEXES
   ========================================== */

purchaseRfqSchema.index(
  {
    tenantId: 1,
    rfqNumber: 1,
  },
  {
    unique: true,
  },
);

// Only requisition-based RFQs participate.
// Direct RFQs with null source references do not conflict.
purchaseRfqSchema.index(
  {
    tenantId: 1,
    sourceRequisitionId: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      creationMode: "REQUISITION",
      reservesSource: true,
    },
  },
);

purchaseRfqSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  rfqDate: -1,
  _id: -1,
});

purchaseRfqSchema.index({
  tenantId: 1,
  supplierIds: 1,
  rfqDate: -1,
});

/* ==========================================
   DOCUMENT VALIDATION
   ========================================== */

purchaseRfqSchema.pre("validate", function () {
  /* ----------------------------------------
     DATE VALIDATION
     ---------------------------------------- */

  if (
    this.rfqDate instanceof Date &&
    this.quotationDueDate instanceof Date &&
    this.quotationDueDate < this.rfqDate
  ) {
    this.invalidate(
      "quotationDueDate",
      "Quotation due date cannot precede RFQ date",
    );
  }

  /* ----------------------------------------
     SOURCE VALIDATION
     ---------------------------------------- */

  if (this.creationMode === "DIRECT") {
    for (const field of [
      "sourceRequisitionId",
      "sourceRequisitionNumber",
      "sourceRequisitionVersion",
    ]) {
      if (this[field] !== null && this[field] !== undefined) {
        this.invalidate(field, `${field} must be null for a DIRECT RFQ`);
      }
    }
  }

  if (this.creationMode === "REQUISITION") {
    if (!this.sourceRequisitionId) {
      this.invalidate(
        "sourceRequisitionId",
        "Source requisition is required for a requisition-based RFQ",
      );
    }

    if (!this.sourceRequisitionNumber) {
      this.invalidate(
        "sourceRequisitionNumber",
        "Source requisition number is required for a requisition-based RFQ",
      );
    }

    if (
      !Number.isSafeInteger(this.sourceRequisitionVersion) ||
      this.sourceRequisitionVersion < 0
    ) {
      this.invalidate(
        "sourceRequisitionVersion",
        "A valid source requisition version is required",
      );
    }
  }

  /* ----------------------------------------
     ITEM REFERENCE VALIDATION
     ---------------------------------------- */

  const seenLineIds = new Set();
  const seenRequisitionLineIds = new Set();

  for (const [index, item] of (this.items || []).entries()) {
    if (item.lineId) {
      const lineId = String(item.lineId);

      if (seenLineIds.has(lineId)) {
        this.invalidate(
          `items.${index}.lineId`,
          "Each RFQ lineId must be unique",
        );
      }

      seenLineIds.add(lineId);
    }

    if (this.creationMode === "DIRECT") {
      if (
        item.requisitionLineId !== null &&
        item.requisitionLineId !== undefined
      ) {
        this.invalidate(
          `items.${index}.requisitionLineId`,
          "DIRECT RFQ items cannot reference requisition lines",
        );
      }
    }

    if (this.creationMode === "REQUISITION") {
      if (!item.requisitionLineId) {
        this.invalidate(
          `items.${index}.requisitionLineId`,
          "Each item must reference a source requisition line",
        );

        continue;
      }

      const requisitionLineId = String(item.requisitionLineId);

      if (seenRequisitionLineIds.has(requisitionLineId)) {
        this.invalidate(
          `items.${index}.requisitionLineId`,
          "A requisition line cannot appear more than once",
        );
      }

      seenRequisitionLineIds.add(requisitionLineId);
    }
  }

  /* ----------------------------------------
     STATUS DETAILS
     ---------------------------------------- */

  if (
    ["ISSUED", "CLOSED"].includes(this.status) &&
    (!this.issuedAt || !this.issuedBy)
  ) {
    this.invalidate("status", "An issued or closed RFQ requires issue details");
  }

  if (this.status === "CLOSED" && (!this.closedAt || !this.closedBy)) {
    this.invalidate("status", "A closed RFQ requires closure details");
  }

  if (
    this.status === "CANCELLED" &&
    (!this.cancelledAt || !this.cancelledBy || !this.cancellationReason)
  ) {
    this.invalidate(
      "status",
      "A cancelled RFQ requires cancellation details and a reason",
    );
  }

  /* ----------------------------------------
     SOURCE RESERVATION
     ---------------------------------------- */

  const expectedReservation =
    this.creationMode === "REQUISITION" &&
    !this.isDeleted &&
    this.status !== "CANCELLED";

  if (this.reservesSource !== expectedReservation) {
    this.invalidate(
      "reservesSource",
      "Source reservation does not match the RFQ creation mode and state",
    );
  }

  /* ----------------------------------------
     SOFT DELETE
     ---------------------------------------- */

  if (
    this.isDeleted &&
    (this.status !== "CREATED" || !this.deletedAt || !this.deletedBy)
  ) {
    this.invalidate(
      "isDeleted",
      "Only CREATED RFQs can be deleted, with deletion details",
    );
  }
});

/* ==========================================
   EXPORT
   ========================================== */

module.exports =
  mongoose.models.PurchaseRfq ||
  mongoose.model("PurchaseRfq", purchaseRfqSchema);
