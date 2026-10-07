const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    customerCode: { type: String, required: true, trim: true },
    customerName: { type: String, required: true, trim: true, maxlength: 200 },
    customerType: {
      type: String,
      enum: ["Business", "Individual"],
      default: "Business",
    },
    contactPerson: String,
    phone: String,
    alternatePhone: String,
    email: { type: String, lowercase: true, trim: true },
    gstNo: { type: String, uppercase: true, trim: true },
    panNo: { type: String, uppercase: true, trim: true },
    billingAddress: String,
    shippingAddress: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: "India" },
    paymentTerms: { type: String, default: "Due on Receipt" },
    creditLimit: { type: Number, default: 0, min: 0 },
    priceList: { type: String, default: "Standard" },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
      index: true,
    },
    notes: String,
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);
schema.index({ tenantId: 1, customerCode: 1 }, { unique: true });
schema.index({ tenantId: 1, customerName: 1 });
module.exports = mongoose.model("Customer", schema);
