const mongoose = require("mongoose");

const SALES_ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

const TAX_MODES = [
  "NONE",
  "INTRA_STATE",
  "INTER_STATE",
];

const GST_RATES = [0, 3, 5, 12, 18, 28];

const AMOUNT_FIELDS = [
  "grossAmountPaise",
  "discountAmountPaise",
  "taxableAmountPaise",
  "cgstAmountPaise",
  "sgstAmountPaise",
  "igstAmountPaise",
  "totalAmountPaise",
];

const integerPaise = () => ({
  type: Number,
  required: true,
  min: 0,
  validate: {
    validator: Number.isSafeInteger,
    message:
      "Amount must be a non-negative safe integer in paise",
  },
});

const optionalText = (maxlength) => ({
  type: String,
  trim: true,
  maxlength,
  default: null,
});

const scaledNumberIsValid = (
  value,
  scale,
) => {
  if (!Number.isFinite(value)) {
    return false;
  }

  const scaled = value * scale;
  const integer = Math.round(scaled);

  return (
    Number.isSafeInteger(integer) &&
    Math.abs(scaled - integer) <= 0.000001
  );
};

const salesOrderItemSchema =
  new mongoose.Schema(
    {
      lineId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        default: () =>
          new mongoose.Types.ObjectId(),
      },

      // Preserved when the order originated
      // from a quotation line.
      quotationLineId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SalesQuotation",
        default: null,
      },

      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },

      productCode: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },

      productName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
      },

      productType: {
        type: String,
        enum: ["GOODS", "SERVICE"],
        required: true,
      },

      unit: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },

      hsnSacCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 20,
        default: null,
      },

      specification: optionalText(1000),

      quantity: {
        type: Number,
        required: true,
        min: 0.001,
        max: 1000000,
        validate: {
          validator: (value) =>
            scaledNumberIsValid(value, 1000),
          message:
            "Quantity must have at most three decimal places",
        },
      },

      unitRatePaise: integerPaise(),

      discountPercent: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
        validate: {
          validator: (value) =>
            scaledNumberIsValid(value, 100),
          message:
            "Discount must have at most two decimal places",
        },
      },

      gstRate: {
        type: Number,
        enum: GST_RATES,
        required: true,
      },

      grossAmountPaise: integerPaise(),
      discountAmountPaise: integerPaise(),
      taxableAmountPaise: integerPaise(),

      cgstAmountPaise: integerPaise(),
      sgstAmountPaise: integerPaise(),
      igstAmountPaise: integerPaise(),

      totalAmountPaise: integerPaise(),
    },
    {
      _id: false,
    },
  );

const salesOrderSchema =
  new mongoose.Schema(
    {
      tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        immutable: true,
      },

      orderNumber: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        maxlength: 100,
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

      customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
        required: true,
      },

      customerCode: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },

      customerName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
      },

      customerGstNo: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      billingAddress: optionalText(2000),
      shippingAddress: optionalText(2000),

      // Optional accepted quotation reference.
      sourceQuotationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SalesQuotation",
        default: null,
        immutable: true,
      },

      sourceQuotationNumber: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
        immutable: true,
      },

      sourceQuotationRevision: {
        type: Number,
        default: null,
        immutable: true,
      },

      currency: {
        type: String,
        enum: ["INR"],
        required: true,
        default: "INR",
      },

      taxMode: {
        type: String,
        enum: TAX_MODES,
        required: true,
      },

      paymentTerms: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
      },

      deliveryTerms: optionalText(1000),

      items: {
        type: [salesOrderItemSchema],
        required: true,
        validate: {
          validator: (items) =>
            Array.isArray(items) &&
            items.length >= 1 &&
            items.length <= 200,
          message:
            "A sales order requires between 1 and 200 items",
        },
      },

      grossAmountPaise: integerPaise(),
      discountAmountPaise: integerPaise(),
      taxableAmountPaise: integerPaise(),

      cgstAmountPaise: integerPaise(),
      sgstAmountPaise: integerPaise(),
      igstAmountPaise: integerPaise(),

      totalAmountPaise: integerPaise(),

      status: {
        type: String,
        enum: SALES_ORDER_STATUSES,
        required: true,
        default: "DRAFT",
      },

      confirmedAt: {
        type: Date,
        default: null,
      },

      confirmedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      startedAt: {
        type: Date,
        default: null,
      },

      startedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      completedAt: {
        type: Date,
        default: null,
      },

      completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      cancelledAt: {
        type: Date,
        default: null,
      },

      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      cancellationReason: optionalText(1000),

      notes: optionalText(1000),

      termsAndConditions: optionalText(5000),

      isDeleted: {
        type: Boolean,
        default: false,
      },

      deletedAt: {
        type: Date,
        default: null,
      },

      deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    },
    {
      timestamps: true,
      optimisticConcurrency: true,

      // Tenant provisioning creates collections
      // and indexes explicitly.
      autoCreate: false,
      autoIndex: false,
    },
  );

salesOrderSchema.index(
  {
    tenantId: 1,
    orderNumber: 1,
  },
  {
    unique: true,
  },
);

salesOrderSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  orderDate: -1,
});

salesOrderSchema.index({
  tenantId: 1,
  customerId: 1,
  orderDate: -1,
});

salesOrderSchema.index({
  tenantId: 1,
  sourceQuotationId: 1,
});

salesOrderSchema.index({
  tenantId: 1,
  status: 1,
  expectedDeliveryDate: 1,
});

salesOrderSchema.pre(
  "validate",
  function () {
    if (
      this.orderDate instanceof Date &&
      this.expectedDeliveryDate instanceof
        Date &&
      this.expectedDeliveryDate <
        this.orderDate
    ) {
      this.invalidate(
        "expectedDeliveryDate",
        "Expected delivery date cannot be before order date",
      );
    }

    const seenLineIds = new Set();

    const totals = Object.fromEntries(
      AMOUNT_FIELDS.map((field) => [
        field,
        0,
      ]),
    );

    for (const item of this.items || []) {
      const lineId = String(item.lineId);

      if (seenLineIds.has(lineId)) {
        this.invalidate(
          "items",
          "Each sales order line must have a unique lineId",
        );
      }

      seenLineIds.add(lineId);

      const amountsAreValid =
        AMOUNT_FIELDS.every(
          (field) =>
            Number.isSafeInteger(
              item[field],
            ) && item[field] >= 0,
        );

      if (!amountsAreValid) {
        this.invalidate(
          "items",
          "Sales order line amounts must be non-negative safe integers",
        );

        return;
      }

      if (
        item.discountAmountPaise >
        item.grossAmountPaise
      ) {
        this.invalidate(
          "items",
          "Line discount cannot exceed the gross amount",
        );
      }

      if (
        item.taxableAmountPaise !==
        item.grossAmountPaise -
          item.discountAmountPaise
      ) {
        this.invalidate(
          "items",
          "Line taxable amount is inconsistent",
        );
      }

      const taxTotal =
        item.cgstAmountPaise +
        item.sgstAmountPaise +
        item.igstAmountPaise;

      const expectedTotal =
        item.taxableAmountPaise + taxTotal;

      if (
        !Number.isSafeInteger(
          expectedTotal,
        ) ||
        item.totalAmountPaise !==
          expectedTotal
      ) {
        this.invalidate(
          "items",
          "Line total is inconsistent",
        );
      }

      if (
        this.taxMode === "NONE" &&
        (item.gstRate !== 0 ||
          taxTotal !== 0)
      ) {
        this.invalidate(
          "items",
          "No-GST sales orders cannot contain GST amounts or rates",
        );
      }

      if (
        this.taxMode === "INTRA_STATE" &&
        item.igstAmountPaise !== 0
      ) {
        this.invalidate(
          "items",
          "Intra-state sales orders cannot contain IGST",
        );
      }

      if (
        this.taxMode === "INTER_STATE" &&
        (item.cgstAmountPaise !== 0 ||
          item.sgstAmountPaise !== 0)
      ) {
        this.invalidate(
          "items",
          "Inter-state sales orders cannot contain CGST or SGST",
        );
      }

      for (const field of AMOUNT_FIELDS) {
        totals[field] += item[field];

        if (
          !Number.isSafeInteger(
            totals[field],
          )
        ) {
          this.invalidate(
            field,
            "Sales order amount exceeds the supported range",
          );

          return;
        }
      }
    }

    for (const field of AMOUNT_FIELDS) {
      if (this[field] !== totals[field]) {
        this.invalidate(
          field,
          `${field} does not match sales order line totals`,
        );
      }
    }

    if (
      this.status !== "DRAFT" &&
      this.status !== "CANCELLED" &&
      (!this.confirmedAt ||
        !this.confirmedBy)
    ) {
      this.invalidate(
        "status",
        "A confirmed sales order requires confirmation details",
      );
    }

    if (
      this.status === "COMPLETED" &&
      (!this.completedAt ||
        !this.completedBy)
    ) {
      this.invalidate(
        "status",
        "A completed sales order requires completion details",
      );
    }

    if (
      this.status === "CANCELLED" &&
      (!this.cancelledAt ||
        !this.cancelledBy)
    ) {
      this.invalidate(
        "status",
        "A cancelled sales order requires cancellation details",
      );
    }

    if (
      this.isDeleted &&
      (this.status !== "DRAFT" ||
        !this.deletedAt ||
        !this.deletedBy)
    ) {
      this.invalidate(
        "isDeleted",
        "Only draft sales orders can be deleted, with deletion details",
      );
    }
  },
);

module.exports =
  mongoose.models.SalesOrder ||
  mongoose.model(
    "SalesOrder",
    salesOrderSchema,
  );