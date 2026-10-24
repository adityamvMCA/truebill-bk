const mongoose = require("mongoose");
const { Schema } = mongoose;
const { quantityMilli } = require("./stockTransfer.utils");
const money = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: "Amount must be safe integer paise" } };
const itemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, immutable: true },
  productCode: { type: String, required: true, immutable: true },
  productName: { type: String, required: true, immutable: true },
  unit: { type: String, required: true, immutable: true },
  quantity: { type: Number, required: true, validate: { validator(value) { try { quantityMilli(value); return true; } catch { return false; } }, message: "Invalid transfer quantity" } },
  unitRatePaise: money,
  totalValuePaise: money,
  sourceStockBefore: { type: Number, required: true, min: 0 },
  sourceStockAfter: { type: Number, required: true, min: 0 },
  destinationStockBefore: { type: Number, required: true, min: 0 },
  destinationStockAfter: { type: Number, required: true, min: 0 },
  aggregateStock: { type: Number, required: true, min: 0 },
  outMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement", required: true },
  inMovementId: { type: Schema.Types.ObjectId, ref: "StockMovement", required: true },
}, { _id: false });
const schema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  transferNumber: { type: String, trim: true, uppercase: true, required: true, immutable: true, maxlength: 100 },
  requestId: { type: String, required: true, immutable: true, lowercase: true },
  requestHash: { type: String, required: true, immutable: true, select: false },
  transferDate: { type: Date, required: true, immutable: true },
  fromWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true, immutable: true },
  fromWarehouseCode: { type: String, required: true, immutable: true },
  fromWarehouseName: { type: String, required: true, immutable: true },
  toWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true, immutable: true },
  toWarehouseCode: { type: String, required: true, immutable: true },
  toWarehouseName: { type: String, required: true, immutable: true },
  items: { type: [itemSchema], required: true, immutable: true, validate: { validator: (items) => items.length >= 1 && items.length <= 100, message: "Provide 1–100 transfer items" } },
  itemCount: { type: Number, required: true, min: 1, max: 100 },
  totalValuePaise: money,
  notes: { type: String, trim: true, maxlength: 500, default: null, immutable: true },
  status: { type: String, enum: ["POSTED"], required: true, default: "POSTED", immutable: true },
  postedAt: { type: Date, required: true, immutable: true },
  postedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, optimisticConcurrency: true, autoCreate: false, autoIndex: false });
schema.index({ tenantId: 1, transferNumber: 1 }, { unique: true });
schema.index({ tenantId: 1, requestId: 1 }, { unique: true });
schema.index({ tenantId: 1, transferDate: -1, _id: -1 });
schema.index({ tenantId: 1, fromWarehouseId: 1, transferDate: -1 });
schema.index({ tenantId: 1, toWarehouseId: 1, transferDate: -1 });
schema.pre("validate", function () {
  if (String(this.fromWarehouseId) === String(this.toWarehouseId)) this.invalidate("toWarehouseId", "Source and destination must be different");
  const ids = new Set(this.items.map((item) => String(item.productId)));
  if (ids.size !== this.items.length) this.invalidate("items", "A Product can appear only once");
  if (this.itemCount !== this.items.length) this.invalidate("itemCount", "Item count does not match items");
  const total = this.items.reduce((sum, item) => sum + BigInt(Number.isSafeInteger(item.totalValuePaise) ? item.totalValuePaise : 0), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || Number(total) !== this.totalValuePaise) this.invalidate("totalValuePaise", "Transfer value does not match item values");
});
module.exports = mongoose.models.StockTransfer || mongoose.model("StockTransfer", schema);
