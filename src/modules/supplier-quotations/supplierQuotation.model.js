const mongoose = require("mongoose");

const { Schema } = mongoose;

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

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

const paise = () => ({
  type: Number,
  required: true,
  min: 0,

  validate: {
    validator: Number.isSafeInteger,
    message: "Amount must be a non-negative safe integer in paise",
  },
});

const scaledIsValid = (value, scale) =>
  Number.isFinite(value) &&
  Number.isSafeInteger(Math.round(value * scale)) &&
  Math.abs(value * scale - Math.round(value * scale)) <= 0.000001;

const itemSchema = new Schema(
  {
    lineId: {
      type: Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
    },

    rfqLineId: {
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

    hsnSacCode: optionalText(20),
    specification: optionalText(1000),

    quantity: {
      type: Number,
      min: 0.001,
      max: 1000000,
      required: true,

      validate: {
        validator: (value) => scaledIsValid(value, 1000),
        message: "Quantity must have at most three decimals",
      },
    },

    unitRatePaise: paise(),

    discountPercent: {
      type: Number,
      min: 0,
      max: 100,
      required: true,

      validate: {
        validator: (value) => scaledIsValid(value, 100),
        message: "Discount must have at most two decimals",
      },
    },

    gstRate: {
      type: Number,
      enum: [0, 3, 5, 12, 18, 28],
      required: true,
    },

    ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, paise()])),
  },
  { _id: false },
);

const supplierQuotationSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    quotationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    creationMode: {
      type: String,
      enum: ["DIRECT", "RFQ"],
      required: true,
      immutable: true,
    },

    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      immutable: true,
    },

    // The supplier's own reference, entered by admin.
    supplierReferenceNumber: optionalText(100),

    quotationDate: {
      type: Date,
      required: true,
    },

    validUntil: {
      type: Date,
      default: null,
    },

    sourceRfqId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseRfq",
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "RFQ";
      },
    },

    sourceRfqNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "RFQ";
      },
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },

    taxMode: {
      type: String,
      enum: ["NONE", "INTRA_STATE", "INTER_STATE"],
      required: true,
    },

    items: {
      type: [itemSchema],
      required: true,

      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,

        message: "Provide between 1 and 200 quotation items",
      },
    },

    ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, paise()])),

    paymentTerms: optionalText(100),
    deliveryTerms: optionalText(1000),
    termsAndConditions: optionalText(5000),
    notes: optionalText(2000),

    status: {
      type: String,
      enum: ["CREATED", "CANCELLED"],
      default: "CREATED",
      required: true,
    },

    reservesRfqSupplier: {
      type: Boolean,
      required: true,

      default: function () {
        return (
          this.creationMode === "RFQ" &&
          !this.isDeleted &&
          this.status !== "CANCELLED"
        );
      },
    },

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

supplierQuotationSchema.index(
  { tenantId: 1, quotationNumber: 1 },
  { unique: true },
);

supplierQuotationSchema.index(
  { tenantId: 1, sourceRfqId: 1, supplierId: 1 },
  {
    unique: true,

    partialFilterExpression: {
      creationMode: "RFQ",
      reservesRfqSupplier: true,
    },
  },
);

supplierQuotationSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  quotationDate: -1,
  _id: -1,
});

supplierQuotationSchema.index({
  tenantId: 1,
  supplierId: 1,
  quotationDate: -1,
});

supplierQuotationSchema.pre("validate", function () {
  if (
    this.validUntil &&
    this.quotationDate &&
    this.validUntil < this.quotationDate
  ) {
    this.invalidate(
      "validUntil",
      "Validity date cannot precede quotation date",
    );
  }

  if (
    this.creationMode === "DIRECT" &&
    (this.sourceRfqId != null || this.sourceRfqNumber != null)
  ) {
    this.invalidate("sourceRfqId", "DIRECT quotations cannot reference an RFQ");
  }

  const seenLines = new Set();
  const seenRfqLines = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  for (const [index, item] of (this.items || []).entries()) {
    const path = `items.${index}`;
    const lineKey = String(item.lineId);

    if (seenLines.has(lineKey)) {
      this.invalidate(`${path}.lineId`, "lineId must be unique");
    }

    seenLines.add(lineKey);

    if (this.creationMode === "DIRECT" && item.rfqLineId != null) {
      this.invalidate(
        `${path}.rfqLineId`,
        "DIRECT items cannot reference RFQ lines",
      );
    }

    if (this.creationMode === "RFQ") {
      if (!item.rfqLineId) {
        this.invalidate(
          `${path}.rfqLineId`,
          "RFQ quotation items require rfqLineId",
        );
      } else {
        const key = String(item.rfqLineId);

        if (seenRfqLines.has(key)) {
          this.invalidate(
            `${path}.rfqLineId`,
            "An RFQ line cannot appear twice",
          );
        }

        seenRfqLines.add(key);
      }
    }

    if (
      !AMOUNT_FIELDS.every(
        (field) => Number.isSafeInteger(item[field]) && item[field] >= 0,
      )
    ) {
      this.invalidate(path, "Invalid item amounts");
      continue;
    }

    const tax =
      item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise;

    if (
      item.discountAmountPaise > item.grossAmountPaise ||
      item.taxableAmountPaise !==
        item.grossAmountPaise - item.discountAmountPaise ||
      item.totalAmountPaise !== item.taxableAmountPaise + tax
    ) {
      this.invalidate(path, "Inconsistent item amounts");
    }

    if (this.taxMode === "NONE" && (item.gstRate !== 0 || tax !== 0)) {
      this.invalidate(path, "NONE tax mode requires zero GST");
    }

    if (this.taxMode === "INTRA_STATE" && item.igstAmountPaise !== 0) {
      this.invalidate(path, "Intra-state items cannot contain IGST");
    }

    if (
      this.taxMode === "INTER_STATE" &&
      (item.cgstAmountPaise !== 0 || item.sgstAmountPaise !== 0)
    ) {
      this.invalidate(path, "Inter-state items cannot contain CGST/SGST");
    }

    for (const field of AMOUNT_FIELDS) {
      totals[field] += item[field];
    }
  }

  for (const field of AMOUNT_FIELDS) {
    if (!Number.isSafeInteger(totals[field]) || this[field] !== totals[field]) {
      this.invalidate(field, `${field} does not match item totals`);
    }
  }

  const expectedReservation =
    this.creationMode === "RFQ" &&
    !this.isDeleted &&
    this.status !== "CANCELLED";

  if (this.reservesRfqSupplier !== expectedReservation) {
    this.invalidate(
      "reservesRfqSupplier",
      "RFQ supplier reservation does not match document state",
    );
  }

  if (
    this.status === "CANCELLED" &&
    (!this.cancelledAt || !this.cancelledBy || !this.cancellationReason)
  ) {
    this.invalidate("status", "Cancellation details are required");
  }

  if (
    this.isDeleted &&
    (this.status !== "CREATED" || !this.deletedAt || !this.deletedBy)
  ) {
    this.invalidate(
      "isDeleted",
      "Only CREATED quotations can be deleted, with deletion details",
    );
  }
});

module.exports =
  mongoose.models.SupplierQuotation ||
  mongoose.model("SupplierQuotation", supplierQuotationSchema);
