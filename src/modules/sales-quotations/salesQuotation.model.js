const mongoose = require("mongoose");

const QUOTATION_STATUSES = [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
];

const TAX_MODES = ["NONE", "INTRA_STATE", "INTER_STATE"];

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
    message: "Amount must be a non-negative safe integer in paise",
  },
});

const optionalText = (maxlength) => ({
  type: String,
  trim: true,
  maxlength,
  default: null,
});

const scaledNumberIsValid = (value, scale) => {
  if (!Number.isFinite(value)) return false;

  const scaled = value * scale;
  const integer = Math.round(scaled);

  return (
    Number.isSafeInteger(integer) && Math.abs(scaled - integer) <= 0.000001
  );
};

const quotationItemSchema = new mongoose.Schema(
  {
    // Preserve this ID when the same line is revised.
    // New alternative/additional lines get new IDs.
    lineId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
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
        validator: (value) => scaledNumberIsValid(value, 1000),
        message: "Quantity must have at most three decimal places",
      },
    },

    unitRatePaise: integerPaise(),

    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      validate: {
        validator: (value) => scaledNumberIsValid(value, 100),
        message: "Discount must have at most two decimal places",
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

const salesQuotationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    quotationNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      immutable: true,
    },

    // Shared by all revisions of a quotation.
    quotationFamilyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },

    revision: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator: Number.isSafeInteger,
        message: "Revision must be a positive safe integer",
      },
    },

    previousRevisionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesQuotation",
      default: null,
      immutable: true,
    },

    // Set on the earlier revision when a replacement
    // revision is issued, not merely drafted.
    supersededById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesQuotation",
      default: null,
    },

    supersededAt: {
      type: Date,
      default: null,
    },

    revisionReason: optionalText(1000),

    // Optional grouping for alternative quotations
    // relating to the same customer requirement.
    comparisonGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      immutable: true,
    },

    enquiryReference: optionalText(100),

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

    quotationDate: {
      type: Date,
      required: true,
    },

    validUntil: {
      type: Date,
      required: true,
    },

    expectedDeliveryDate: {
      type: Date,
      default: null,
    },

    deliveryTerms: optionalText(1000),

    paymentTerms: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
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

    items: {
      type: [quotationItemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,
        message: "A quotation requires between 1 and 200 items",
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
      enum: QUOTATION_STATUSES,
      required: true,
      default: "DRAFT",
    },

    issuedAt: {
      type: Date,
      default: null,
    },

    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    acceptanceReference: optionalText(200),

    rejectedAt: {
      type: Date,
      default: null,
    },

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    rejectionReason: optionalText(1000),

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

    // Create tenant collections/indexes explicitly.
    autoCreate: false,
    autoIndex: false,
  },
);

salesQuotationSchema.index(
  {
    tenantId: 1,
    quotationNumber: 1,
    revision: 1,
  },
  {
    unique: true,
  },
);

salesQuotationSchema.index(
  {
    tenantId: 1,
    quotationFamilyId: 1,
    revision: 1,
  },
  {
    unique: true,
  },
);

salesQuotationSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  quotationDate: -1,
});

salesQuotationSchema.index({
  tenantId: 1,
  customerId: 1,
  quotationDate: -1,
});

salesQuotationSchema.index({
  tenantId: 1,
  comparisonGroupId: 1,
  customerId: 1,
});

salesQuotationSchema.index({
  tenantId: 1,
  status: 1,
  validUntil: 1,
});

salesQuotationSchema.pre("validate", function () {
  if (
    this.quotationDate instanceof Date &&
    this.validUntil instanceof Date &&
    this.validUntil < this.quotationDate
  ) {
    this.invalidate(
      "validUntil",
      "Validity date cannot be before quotation date",
    );
  }

  if (
    this.expectedDeliveryDate &&
    this.quotationDate &&
    this.expectedDeliveryDate < this.quotationDate
  ) {
    this.invalidate(
      "expectedDeliveryDate",
      "Expected delivery date cannot be before quotation date",
    );
  }

  if (this.revision === 1 && this.previousRevisionId) {
    this.invalidate(
      "previousRevisionId",
      "The first revision cannot have a previous revision",
    );
  }

  if (this.revision > 1 && !this.previousRevisionId) {
    this.invalidate(
      "previousRevisionId",
      "A revised quotation requires its previous revision",
    );
  }

  if (Boolean(this.supersededById) !== Boolean(this.supersededAt)) {
    this.invalidate(
      "supersededById",
      "Superseding revision and timestamp must be provided together",
    );
  }

  if (
    this.previousRevisionId &&
    String(this.previousRevisionId) === String(this._id)
  ) {
    this.invalidate(
      "previousRevisionId",
      "A quotation cannot reference itself as its previous revision",
    );
  }

  if (this.supersededById && String(this.supersededById) === String(this._id)) {
    this.invalidate("supersededById", "A quotation cannot supersede itself");
  }

  const seenLineIds = new Set();

  const totals = Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, 0]));

  for (const item of this.items || []) {
    if (item.lineId) {
      const lineId = String(item.lineId);

      if (seenLineIds.has(lineId)) {
        this.invalidate(
          "items",
          "Each quotation line must have a unique lineId",
        );
      }

      seenLineIds.add(lineId);
    }

    const amountsAreValid = AMOUNT_FIELDS.every(
      (field) => Number.isSafeInteger(item[field]) && item[field] >= 0,
    );

    if (!amountsAreValid) {
      this.invalidate(
        "items",
        "Quotation line amounts must be non-negative safe integers",
      );

      return;
    }

    if (item.discountAmountPaise > item.grossAmountPaise) {
      this.invalidate("items", "Line discount cannot exceed the gross amount");
    }

    if (
      item.taxableAmountPaise !==
      item.grossAmountPaise - item.discountAmountPaise
    ) {
      this.invalidate("items", "Line taxable amount is inconsistent");
    }

    const taxTotal =
      item.cgstAmountPaise + item.sgstAmountPaise + item.igstAmountPaise;

    const expectedTotal = item.taxableAmountPaise + taxTotal;

    if (
      !Number.isSafeInteger(expectedTotal) ||
      item.totalAmountPaise !== expectedTotal
    ) {
      this.invalidate("items", "Line total is inconsistent");
    }

    if (this.taxMode === "NONE" && (item.gstRate !== 0 || taxTotal !== 0)) {
      this.invalidate(
        "items",
        "No-GST quotations cannot contain GST amounts or rates",
      );
    }

    if (this.taxMode === "INTRA_STATE" && item.igstAmountPaise !== 0) {
      this.invalidate("items", "Intra-state quotations cannot contain IGST");
    }

    if (
      this.taxMode === "INTER_STATE" &&
      (item.cgstAmountPaise !== 0 || item.sgstAmountPaise !== 0)
    ) {
      this.invalidate(
        "items",
        "Inter-state quotations cannot contain CGST or SGST",
      );
    }

    for (const field of AMOUNT_FIELDS) {
      totals[field] += item[field];

      if (!Number.isSafeInteger(totals[field])) {
        this.invalidate(field, "Quotation amount exceeds the supported range");

        return;
      }
    }
  }

  for (const field of AMOUNT_FIELDS) {
    if (this[field] !== totals[field]) {
      this.invalidate(field, `${field} does not match quotation line totals`);
    }
  }

  if (
    this.status === "ISSUED" ||
    this.status === "ACCEPTED" ||
    this.status === "REJECTED"
  ) {
    if (!this.issuedAt || !this.issuedBy) {
      this.invalidate(
        "status",
        "An issued quotation requires issuedAt and issuedBy",
      );
    }
  }

  if (this.status === "ACCEPTED" && (!this.acceptedAt || !this.acceptedBy)) {
    this.invalidate(
      "status",
      "An accepted quotation requires acceptance details",
    );
  }

  if (this.status === "REJECTED" && (!this.rejectedAt || !this.rejectedBy)) {
    this.invalidate(
      "status",
      "A rejected quotation requires rejection details",
    );
  }

  if (this.status === "CANCELLED" && (!this.cancelledAt || !this.cancelledBy)) {
    this.invalidate(
      "status",
      "A cancelled quotation requires cancellation details",
    );
  }

  if (
    this.isDeleted &&
    (this.status !== "DRAFT" || !this.deletedAt || !this.deletedBy)
  ) {
    this.invalidate(
      "isDeleted",
      "Only drafts can be deleted, with deletion details",
    );
  }
});

module.exports =
  mongoose.models.SalesQuotation ||
  mongoose.model("SalesQuotation", salesQuotationSchema);
