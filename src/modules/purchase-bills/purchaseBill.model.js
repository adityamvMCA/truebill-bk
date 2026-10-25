// const mongoose = require("mongoose");

// const integerPaise = (required = true) => ({
//   type: Number,
//   required,
//   min: 0,
//   validate: {
//     validator: Number.isSafeInteger,
//     message: "Amount must be a non-negative safe integer in paise",
//   },
// });

// const itemSchema = new mongoose.Schema(
//   {
//     productId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Product",
//       required: true,
//     },

//     productCode: {
//       type: String,
//       required: true,
//       trim: true,
//       uppercase: true,
//     },

//     productName: {
//       type: String,
//       required: true,
//       trim: true,
//       maxlength: 200,
//     },

//     productType: {
//       type: String,
//       enum: ["GOODS", "SERVICE"],
//       required: true,
//     },

//     trackInventory: {
//       type: Boolean,
//       required: true,
//     },

//     unit: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     hsnSacCode: {
//       type: String,
//       default: null,
//       trim: true,
//     },

//     quantity: {
//       type: Number,
//       required: true,
//       min: 0.001,
//     },

//     unitRatePaise: integerPaise(),

//     discountPercent: {
//       type: Number,
//       required: true,
//       min: 0,
//       max: 100,
//     },

//     gstRate: {
//       type: Number,
//       required: true,
//       enum: [0, 3, 5, 12, 18, 28],
//     },

//     taxCreditEligible: {
//       type: Boolean,
//       required: true,
//       default: false,
//     },

//     purchaseLedgerId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "AccountingLedger",
//       required: true,
//     },
//     tdsAmountPaise: {
//       type: Number,
//       default: 0,
//       min: 0,
//       validate: { validator: Number.isSafeInteger },
//     },
//     tds: {
//       type: new mongoose.Schema(
//         {
//           natureId: mongoose.Schema.Types.ObjectId,
//           section: String,
//           deducteeType: String,
//           pan: { type: String, default: null },
//           ratePercent: Number,
//           taxableBasePaise: Number,
//           reason: String,
//           certificateNumber: { type: String, default: null },
//           tdsLedgerId: mongoose.Schema.Types.ObjectId,
//         },
//         { _id: false },
//       ),
//       default: null,
//     },
//     grossAmountPaise: integerPaise(),
//     discountAmountPaise: integerPaise(),
//     taxableAmountPaise: integerPaise(),

//     cgstAmountPaise: integerPaise(),
//     sgstAmountPaise: integerPaise(),
//     igstAmountPaise: integerPaise(),

//     totalAmountPaise: integerPaise(),
//   },
//   { _id: false },
// );

// const purchaseBillSchema = new mongoose.Schema(
//   {
//     tenantId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Tenant",
//       required: true,
//       index: true,
//     },

//     billNumber: {
//       type: String,
//       required: true,
//       trim: true,
//       uppercase: true,
//     },

//     supplierId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Supplier",
//       required: true,
//     },

//     supplierCode: {
//       type: String,
//       required: true,
//       trim: true,
//       uppercase: true,
//     },

//     supplierName: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     supplierLedgerId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "AccountingLedger",
//       required: true,
//     },

//     supplierGstNo: {
//       type: String,
//       default: null,
//       trim: true,
//       uppercase: true,
//     },

//     supplierInvoiceNumber: {
//       type: String,
//       required: true,
//       trim: true,
//       maxlength: 100,
//     },

//     supplierInvoiceNumberNormalized: {
//       type: String,
//       required: true,
//       trim: true,
//       uppercase: true,
//     },

//     billDate: {
//       type: Date,
//       required: true,
//     },

//     dueDate: {
//       type: Date,
//       required: true,
//     },

//     currency: {
//       type: String,
//       enum: ["INR"],
//       default: "INR",
//       required: true,
//     },

//     paymentTerms: {
//       type: String,
//       required: true,
//       trim: true,
//       maxlength: 100,
//     },

//     // Explicit in version one; not inferred from free-text addresses.
//     taxMode: {
//       type: String,
//       // enum: ["NONE", "INTRA_STATE", "INTER_STATE"],
//       enum: ["NONE", "INTRASTATE", "INTERSTATE"],
//       required: true,
//     },

//     // No GRN integration in version one.
//     updateStock: {
//       type: Boolean,
//       required: true,
//       default: false,
//     },

//     items: {
//       type: [itemSchema],
//       required: true,
//       validate: {
//         validator: (items) =>
//           Array.isArray(items) && items.length >= 1 && items.length <= 200,
//         message: "A purchase bill requires between 1 and 200 items",
//       },
//     },

//     grossAmountPaise: integerPaise(),
//     discountAmountPaise: integerPaise(),
//     taxableAmountPaise: integerPaise(),

//     cgstAmountPaise: integerPaise(),
//     sgstAmountPaise: integerPaise(),
//     igstAmountPaise: integerPaise(),

//     totalAmountPaise: integerPaise(),
//     paidAmountPaise: integerPaise(),
//     outstandingAmountPaise: integerPaise(),

//     status: {
//       type: String,

//       // DRAFT is retained only for existing records.
//       // New bills are created and posted in one transaction.
//       enum: ["CREATED", "POSTED", "CANCELLED", "DRAFT"],

//       default: "CREATED",
//       required: true,
//     },
//     paymentStatus: {
//       type: String,

//       enum: ["UNPAID", "PARTIALLY_PAID", "PAID", "SETTLED"],

//       default: "UNPAID",
//       required: true,
//     },

//     journalId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "AccountingJournal",
//       default: null,
//     },

//     postedAt: {
//       type: Date,
//       default: null,
//     },

//     postedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null,
//     },

//     notes: {
//       type: String,
//       default: null,
//       trim: true,
//       maxlength: 1000,
//     },

//     isDeleted: {
//       type: Boolean,
//       default: false,
//     },

//     deletedAt: {
//       type: Date,
//       default: null,
//     },

//     deletedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null,
//     },

//     createdBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },

//     updatedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },
//     sourceGoodsReceiptId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "GoodsReceipt",
//       default: null,
//       immutable: true,
//     },
//     returnedAmountPaise: {
//       ...integerPaise(),
//       default: 0,
//     },

//     supplierCreditAmountPaise: {
//       ...integerPaise(),
//       default: 0,
//     },
//   },
//   {
//     timestamps: true,
//     optimisticConcurrency: true,
//   },
// );

// purchaseBillSchema.index({ tenantId: 1, billNumber: 1 }, { unique: true });

// // Version-one policy: no duplicate invoice number for the same supplier
// // among non-deleted bills.
// purchaseBillSchema.index(
//   {
//     tenantId: 1,
//     supplierId: 1,
//     supplierInvoiceNumberNormalized: 1,
//   },
//   {
//     unique: true,
//     partialFilterExpression: {
//       isDeleted: false,
//     },
//   },
// );

// purchaseBillSchema.index({
//   tenantId: 1,
//   isDeleted: 1,
//   status: 1,
//   billDate: -1,
// });
// purchaseBillSchema.index(
//   {
//     tenantId: 1,
//     sourceGoodsReceiptId: 1,
//   },
//   {
//     unique: true,

//     partialFilterExpression: {
//       sourceGoodsReceiptId: { $type: "objectId" },
//       isDeleted: false,
//     },
//   },
// );
// purchaseBillSchema.index({
//   tenantId: 1,
//   supplierId: 1,
//   status: 1,
//   dueDate: 1,
// });

// module.exports =
//   mongoose.models.PurchaseBill ||
//   mongoose.model("PurchaseBill", purchaseBillSchema);


const mongoose = require("mongoose");

const integerPaise = (required = true) => ({
  type: Number,
  required,
  min: 0,
  validate: {
    validator: Number.isSafeInteger,
    message: "Amount must be a non-negative safe integer in paise",
  },
});

const itemSchema = new mongoose.Schema(
  {
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

    trackInventory: {
      type: Boolean,
      required: true,
    },

    unit: {
      type: String,
      required: true,
      trim: true,
    },

    hsnSacCode: {
      type: String,
      default: null,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },

    unitRatePaise: integerPaise(),

    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    gstRate: {
      type: Number,
      required: true,
      enum: [0, 3, 5, 12, 18, 28],
    },

    taxCreditEligible: {
      type: Boolean,
      required: true,
      default: false,
    },

    purchaseLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
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
  { _id: false },
);

// TDS details live on the BILL, not on each item.
const billTdsSchema = new mongoose.Schema(
  {
    natureId: { type: mongoose.Schema.Types.ObjectId },
    section: { type: String },
    deducteeType: { type: String },
    pan: { type: String, default: null },
    ratePercent: { type: Number },
    taxableBasePaise: { type: Number },
    reason: { type: String },
    certificateNumber: { type: String, default: null },
    tdsLedgerId: { type: mongoose.Schema.Types.ObjectId },
  },
  { _id: false },
);

const purchaseBillSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    billNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },

    supplierCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    supplierName: {
      type: String,
      required: true,
      trim: true,
    },

    supplierLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      required: true,
    },

    supplierGstNo: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },

    supplierInvoiceNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    supplierInvoiceNumberNormalized: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    billDate: {
      type: Date,
      required: true,
    },

    dueDate: {
      type: Date,
      required: true,
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
      required: true,
    },

    paymentTerms: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    taxMode: {
      type: String,
      enum: ["NONE", "INTRASTATE", "INTERSTATE"],
      required: true,
    },

    updateStock: {
      type: Boolean,
      required: true,
      default: false,
    },

    items: {
      type: [itemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length >= 1 && items.length <= 200,
        message: "A purchase bill requires between 1 and 200 items",
      },
    },

    grossAmountPaise: integerPaise(),
    discountAmountPaise: integerPaise(),
    taxableAmountPaise: integerPaise(),

    cgstAmountPaise: integerPaise(),
    sgstAmountPaise: integerPaise(),
    igstAmountPaise: integerPaise(),

    totalAmountPaise: integerPaise(),

    // TDS withheld from the supplier. Payable to the supplier is
    // totalAmountPaise - tdsAmountPaise.
    tdsAmountPaise: {
      ...integerPaise(false),
      default: 0,
    },

    tds: {
      type: billTdsSchema,
      default: null,
    },

    paidAmountPaise: integerPaise(),
    outstandingAmountPaise: integerPaise(),

    status: {
      type: String,
      enum: ["CREATED", "POSTED", "CANCELLED", "DRAFT"],
      default: "CREATED",
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIALLY_PAID", "PAID", "SETTLED"],
      default: "UNPAID",
      required: true,
    },

    journalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingJournal",
      default: null,
    },

    postedAt: {
      type: Date,
      default: null,
    },

    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },

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

    sourceGoodsReceiptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodsReceipt",
      default: null,
      immutable: true,
    },

    returnedAmountPaise: {
      ...integerPaise(),
      default: 0,
    },

    supplierCreditAmountPaise: {
      ...integerPaise(),
      default: 0,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

purchaseBillSchema.index({ tenantId: 1, billNumber: 1 }, { unique: true });

purchaseBillSchema.index(
  {
    tenantId: 1,
    supplierId: 1,
    supplierInvoiceNumberNormalized: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
  },
);

purchaseBillSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  billDate: -1,
});

purchaseBillSchema.index(
  {
    tenantId: 1,
    sourceGoodsReceiptId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      sourceGoodsReceiptId: { $type: "objectId" },
      isDeleted: false,
    },
  },
);

purchaseBillSchema.index({
  tenantId: 1,
  supplierId: 1,
  status: 1,
  dueDate: 1,
});

module.exports =
  mongoose.models.PurchaseBill ||
  mongoose.model("PurchaseBill", purchaseBillSchema);