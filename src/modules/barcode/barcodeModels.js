const mongoose = require("mongoose");
const { Schema } = mongoose;

const BARCODE_TYPES = ["EAN13", "EAN8", "UPC_A", "CODE128", "ITF14", "QR"];
const BARCODE_SOURCES = ["MANUFACTURER", "SUPPLIER", "INTERNAL", "GS1_ASSIGNED"];

const productBarcodeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    barcode: { type: String, required: true, trim: true, maxlength: 64 },
    barcodeType: { type: String, enum: BARCODE_TYPES, default: "CODE128" },
    source: { type: String, enum: BARCODE_SOURCES, required: true },
    packagingName: { type: String, default: "Unit", trim: true, maxlength: 60 },
    conversionQuantity: { type: Number, default: 1, min: 0.001 },
    unit: { type: String, default: null, uppercase: true, trim: true },
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
// O(1) scan lookup + tenant-wide duplicate prevention
productBarcodeSchema.index({ tenantId: 1, barcode: 1 }, { unique: true });
productBarcodeSchema.index({ tenantId: 1, productId: 1 });
// cursor-paged catalogue download
productBarcodeSchema.index({ tenantId: 1, _id: 1 });

const scanSessionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    sessionCode: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    documentType: {
      type: String,
      enum: ["PURCHASE", "SALES", "STOCK_IN", "STOCK_OUT", "INVENTORY"],
      required: true,
    },
    documentId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ["ACTIVE", "CLOSED"], default: "ACTIVE" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
scanSessionSchema.index({ tenantId: 1, sessionCode: 1 }, { unique: true });
scanSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

const scanItemSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    sessionId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    barcode: { type: String, required: true },
    quantity: { type: Number, default: 0 },
    unit: String,
    packaging: String,
    scanCount: { type: Number, default: 0 },
    createdBy: Schema.Types.ObjectId,
    lastScannedAt: Date,
  },
  { timestamps: true },
);
// one row per product+packaging per session -> atomic $inc upsert
scanItemSchema.index(
  { tenantId: 1, sessionId: 1, productId: 1, packaging: 1 },
  { unique: true },
);

// idempotency ledger: rejects retries / offline re-sync duplicates
const scanEventSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  sessionId: { type: Schema.Types.ObjectId, required: true },
  scanId: { type: String, required: true, maxlength: 64 },
  createdAt: { type: Date, default: Date.now },
});
scanEventSchema.index({ tenantId: 1, scanId: 1 }, { unique: true });
scanEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const unknownBarcodeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    barcode: { type: String, required: true },
    firstSeenBy: Schema.Types.ObjectId,
    seenCount: { type: Number, default: 1 },
    status: { type: String, enum: ["PENDING", "RESOLVED"], default: "PENDING" },
  },
  { timestamps: true },
);
unknownBarcodeSchema.index({ tenantId: 1, barcode: 1 }, { unique: true });

// Compiled on the default mongoose instance, exactly like your other module models.
// tenantAccountingModels.registerModel() clones each schema onto the tenant connection.
const ProductBarcode =
  mongoose.models.ProductBarcode || mongoose.model("ProductBarcode", productBarcodeSchema);
const ScanSession =
  mongoose.models.ScanSession || mongoose.model("ScanSession", scanSessionSchema);
const ScanItem = mongoose.models.ScanItem || mongoose.model("ScanItem", scanItemSchema);
const ScanEvent = mongoose.models.ScanEvent || mongoose.model("ScanEvent", scanEventSchema);
const UnknownBarcode =
  mongoose.models.UnknownBarcode || mongoose.model("UnknownBarcode", unknownBarcodeSchema);

module.exports = {
  ProductBarcode, ScanSession, ScanItem, ScanEvent, UnknownBarcode,
  BARCODE_TYPES, BARCODE_SOURCES,
};
