const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    employeeCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    designation: {
      type: String,
      trim: true,
      default: "Staff",
    },

    department: {
      type: String,
      trim: true,
      default: "General",
    },

    dateOfJoining: {
      type: Date,
      default: Date.now,
    },

    dateOfRelieving: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive", "On Leave"],
      default: "Active",
      index: true,
    },

    panNo: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },

    aadhaarNo: {
      type: String,
      trim: true,
      default: "",
    },

    uanNo: {
      type: String,
      trim: true,
      default: "",
    },

    esiNo: {
      type: String,
      trim: true,
      default: "",
    },

    bankDetails: {
      bankName: { type: String, default: "", trim: true },
      accountNumber: { type: String, default: "", trim: true },
      ifscCode: { type: String, default: "", trim: true, uppercase: true },
      branch: { type: String, default: "", trim: true },
    },

    salaryStructure: {
      basicSalary: { type: Number, default: 0, min: 0 },
      hra: { type: Number, default: 0, min: 0 },
      conveyance: { type: Number, default: 0, min: 0 },
      specialAllowance: { type: Number, default: 0, min: 0 },
      medicalAllowance: { type: Number, default: 0, min: 0 },
      // Deductions
      epfDeduction: { type: Number, default: 0, min: 0 },
      esiDeduction: { type: Number, default: 0, min: 0 },
      professionalTax: { type: Number, default: 0, min: 0 },
      tdsDeduction: { type: Number, default: 0, min: 0 },
      // Computed summary
      grossSalary: { type: Number, default: 0, min: 0 },
      netSalary: { type: Number, default: 0, min: 0 },
    },

    // Reference to Accounting Ledger
    ledgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountingLedger",
      default: null,
    },

    // Optional user link
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    notes: {
      type: String,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "employees",
  }
);

employeeSchema.index({ tenantId: 1, employeeCode: 1 }, { unique: true });
employeeSchema.index({ tenantId: 1, name: 1 });
employeeSchema.index({ tenantId: 1, isDeleted: 1, status: 1 });

module.exports = mongoose.model("Employee", employeeSchema);
