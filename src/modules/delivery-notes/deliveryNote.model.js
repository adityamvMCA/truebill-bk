const mongoose = require("mongoose");

const { Schema } = mongoose;

const DELIVERY_NOTE_STATUSES = [
  "CREATED",
  "DISPATCHED",
  "DELIVERED",
  "CANCELLED",
];

const optionalText = (maxlength) => ({
  type: String,
  trim: true,
  maxlength,
  default: null,
});

const optionalUser = () => ({
  type: Schema.Types.ObjectId,
  ref: "User",
  default: null,
});

const isValidDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

const validQuantity = (value) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0.001 ||
    value > 1000000
  ) {
    return false;
  }

  const scaled = value * 1000;
  const integer = Math.round(scaled);

  return (
    Number.isSafeInteger(integer) && Math.abs(scaled - integer) <= 0.000001
  );
};

/* ==========================================
   DELIVERY NOTE ITEM
   ========================================== */

const deliveryNoteItemSchema = new Schema(
  {
    lineId: {
      type: Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
    },

    // Reference to a line inside the linked Sales Order.
    // This is not a reference to a standalone collection.
    salesOrderLineId: {
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
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
    },

    productName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Physical Delivery Notes contain goods only.
    productType: {
      type: String,
      enum: ["GOODS"],
      required: true,
    },

    unit: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 30,
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
        validator: validQuantity,
        message:
          "Quantity must be between 0.001 and 1,000,000 with at most three decimal places",
      },
    },

    // Snapshot of the Product inventory setting.
    trackInventory: {
      type: Boolean,
      required: true,
    },

    // Assigned by the dispatch transaction.
    stockMovementId: {
      type: Schema.Types.ObjectId,
      ref: "StockMovement",
      default: null,
    },

    notes: optionalText(500),
  },
  {
    _id: false,
  },
);

/* ==========================================
   DELIVERY NOTE
   ========================================== */

const deliveryNoteSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },

    deliveryNoteNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      immutable: true,
    },

    // Document date, not the actual dispatch timestamp.
    deliveryDate: {
      type: Date,
      required: true,
    },

    expectedDeliveryDate: {
      type: Date,
      default: null,
    },

    /* ---------- Customer snapshot ---------- */

    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    customerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
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
      maxlength: 20,
      default: null,
    },

    contactPerson: optionalText(150),

    contactPhone: optionalText(30),

    billingAddress: optionalText(2000),

    shippingAddress: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    /* ---------- Source Sales Order ---------- */

    sourceSalesOrderId: {
      type: Schema.Types.ObjectId,
      ref: "SalesOrder",
      default: null,
      immutable: true,
    },

    sourceSalesOrderNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: null,
      immutable: true,
    },

    customerReference: optionalText(100),

    /* ---------- Transport details ---------- */

    transporterName: optionalText(200),

    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 30,
      default: null,
    },

    trackingNumber: optionalText(100),

    transportDocumentNumber: optionalText(100),

    transportDocumentDate: {
      type: Date,
      default: null,
    },

    // Informational reference only.
    // The module does not generate an e-way bill.
    eWayBillNumber: optionalText(50),

    /* ---------- Items ---------- */

    items: {
      type: [deliveryNoteItemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,
        message: "A delivery note requires between 1 and 200 items",
      },
    },

    /* ---------- Workflow ---------- */

    status: {
      type: String,
      enum: DELIVERY_NOTE_STATUSES,
      required: true,
      default: "CREATED",
    },

    dispatchedAt: {
      type: Date,
      default: null,
    },

    dispatchedBy: optionalUser(),

    dispatchRemarks: optionalText(1000),

    deliveredAt: {
      type: Date,
      default: null,
    },

    // Application user who records receipt acknowledgment.
    deliveredBy: optionalUser(),

    // Customer-side recipient.
    receivedByName: optionalText(150),

    receivedByPhone: optionalText(30),

    deliveryRemarks: optionalText(1000),

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelledBy: optionalUser(),

    cancellationReason: optionalText(1000),

    /* ---------- Additional information ---------- */

    notes: optionalText(1000),

    termsAndConditions: optionalText(5000),

    /* ---------- Soft deletion ---------- */

    isDeleted: {
      type: Boolean,
      required: true,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: optionalUser(),

    /* ---------- Audit users ---------- */

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,

    // Tenant provisioning creates collections and indexes.
    autoCreate: false,
    autoIndex: false,
  },
);
deliveryNoteSchema.index(
  {
    tenantId: 1,
    deliveryNoteNumber: 1,
  },
  {
    unique: true,
  },
);


module.exports =
  mongoose.models.DeliveryNote ||
  mongoose.model(
    "DeliveryNote",
    deliveryNoteSchema,
  );