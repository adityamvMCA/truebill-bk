const mongoose = require("mongoose");

const SupplierQuotation = require("../supplier-quotations/supplierQuotation.model");

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
  min: 0,
  required: true,

  validate: {
    validator: Number.isSafeInteger,
    message: "Amount must be a non-negative safe integer",
  },
});

const itemSchema = SupplierQuotation.schema.path("items").schema.clone();

itemSchema.remove("rfqLineId");

itemSchema.add({
  quotationLineId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
});

const purchaseOrderSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    orderNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      required: true,
      immutable: true,
    },

    creationMode: {
      type: String,
      enum: ["DIRECT", "QUOTATION"],
      required: true,
      immutable: true,
    },

    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      immutable: true,
    },

    orderDate: {
      type: Date,
      required: true,
    },

    expectedDeliveryDate: {
      type: Date,
      default: null,
    },

    sourceQuotationId: {
      type: Schema.Types.ObjectId,
      ref: "SupplierQuotation",
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "QUOTATION";
      },
    },

    sourceQuotationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "QUOTATION";
      },
    },

    sourceQuotationVersion: {
      type: Number,
      min: 0,
      default: null,
      immutable: true,

      required: function () {
        return this.creationMode === "QUOTATION";
      },

      validate: {
        validator: (value) => value === null || Number.isSafeInteger(value),

        message: "Invalid source quotation version",
      },
    },

    sourceRfqId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseRfq",
      default: null,
      immutable: true,
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

        message: "Provide between 1 and 200 order items",
      },
    },

    ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, paise()])),

    deliveryAddress: optionalText(2000),
    paymentTerms: optionalText(100),
    deliveryTerms: optionalText(1000),
    termsAndConditions: optionalText(5000),
    notes: optionalText(2000),

    status: {
      type: String,

      enum: ["CREATED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],

      default: "CREATED",
      required: true,
    },

    reservesSource: {
      type: Boolean,
      required: true,

      default: function () {
        return this.creationMode === "QUOTATION" && this.status !== "CANCELLED";
      },
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelledBy: userReference(),

    cancellationReason: optionalText(1000),

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

purchaseOrderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });

purchaseOrderSchema.index(
  { tenantId: 1, sourceQuotationId: 1 },
  {
    unique: true,

    partialFilterExpression: {
      creationMode: "QUOTATION",
      reservesSource: true,
    },
  },
);

purchaseOrderSchema.index(
  { tenantId: 1, sourceRfqId: 1 },
  {
    unique: true,

    partialFilterExpression: {
      sourceRfqId: { $type: "objectId" },
      reservesSource: true,
    },
  },
);

purchaseOrderSchema.index({
  tenantId: 1,
  status: 1,
  orderDate: -1,
  _id: -1,
});

purchaseOrderSchema.index({
  tenantId: 1,
  supplierId: 1,
  orderDate: -1,
});

purchaseOrderSchema.pre("validate", function () {
  if (
    this.expectedDeliveryDate &&
    this.orderDate &&
    this.expectedDeliveryDate < this.orderDate
  ) {
    this.invalidate(
      "expectedDeliveryDate",
      "Expected delivery date cannot precede order date",
    );
  }

  if (this.creationMode === "DIRECT") {
    for (const field of [
      "sourceQuotationId",
      "sourceQuotationNumber",
      "sourceQuotationVersion",
      "sourceRfqId",
    ]) {
      if (this[field] != null) {
        this.invalidate(
          field,
          "DIRECT orders cannot contain source references",
        );
      }
    }
  }

  const seenLines = new Set();
  const seenSourceLines = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  for (const [index, item] of (this.items || []).entries()) {
    const path = `items.${index}`;
    const key = String(item.lineId);

    if (seenLines.has(key)) {
      this.invalidate(`${path}.lineId`, "lineId must be unique");
    }

    seenLines.add(key);

    if (this.creationMode === "DIRECT" && item.quotationLineId != null) {
      this.invalidate(
        `${path}.quotationLineId`,
        "DIRECT items cannot reference quotation lines",
      );
    }

    if (this.creationMode === "QUOTATION") {
      if (!item.quotationLineId) {
        this.invalidate(
          `${path}.quotationLineId`,
          "Source quotation line is required",
        );
      } else {
        const sourceKey = String(item.quotationLineId);

        if (seenSourceLines.has(sourceKey)) {
          this.invalidate(
            `${path}.quotationLineId`,
            "A source quotation line cannot appear twice",
          );
        }

        seenSourceLines.add(sourceKey);
      }
    }

    if (
      !AMOUNT_FIELDS.every(
        (field) => Number.isSafeInteger(item[field]) && item[field] >= 0,
      )
    ) {
      this.invalidate(path, "Invalid order item amounts");
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
      this.invalidate(path, "Inconsistent order item amounts");
    }

    if (this.taxMode === "NONE" && (item.gstRate !== 0 || tax !== 0)) {
      this.invalidate(path, "NONE tax mode requires zero GST");
    }

    if (this.taxMode === "INTRA_STATE" && item.igstAmountPaise !== 0) {
      this.invalidate(path, "Intra-state orders cannot contain IGST");
    }

    if (
      this.taxMode === "INTER_STATE" &&
      (item.cgstAmountPaise !== 0 || item.sgstAmountPaise !== 0)
    ) {
      this.invalidate(path, "Inter-state orders cannot contain CGST/SGST");
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
    this.creationMode === "QUOTATION" && this.status !== "CANCELLED";

  if (this.reservesSource !== expectedReservation) {
    this.invalidate(
      "reservesSource",
      "Source reservation does not match order state",
    );
  }

  if (
    this.status === "CANCELLED" &&
    (!this.cancelledAt || !this.cancelledBy || !this.cancellationReason)
  ) {
    this.invalidate("status", "Cancellation details are required");
  }
});

module.exports =
  mongoose.models.PurchaseOrder ||
  mongoose.model("PurchaseOrder", purchaseOrderSchema);
