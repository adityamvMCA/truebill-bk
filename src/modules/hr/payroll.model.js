const mongoose = require("mongoose");

const payrollSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    slipNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },

    employeeCode: { type: String, default: "" },
    employeeName: { type: String, required: true },
    designation: { type: String, default: "" },
    department: { type: String, default: "" },

    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },

    year: {
      type: Number,
      required: true,
      min: 2000,
    },

    period: {
      type: String,
      required: true, // e.g. "November 2026"
    },

    workingDays: { type: Number, default: 30, min: 0 },
    presentDays: { type: Number, default: 30, min: 0 },
    paidLeaves: { type: Number, default: 0, min: 0 },
    unpaidLeaves: { type: Number, default: 0, min: 0 },

    earnings: {
      basic: { type: Number, default: 0, min: 0 },
      hra: { type: Number, default: 0, min: 0 },
      conveyance: { type: Number, default: 0, min: 0 },
      specialAllowance: { type: Number, default: 0, min: 0 },
      medical: { type: Number, default: 0, min: 0 },
      bonus: { type: Number, default: 0, min: 0 },
      overtime: { type: Number, default: 0, min: 0 },
      totalEarnings: { type: Number, default: 0, min: 0 },
    },

    deductions: {
      epf: { type: Number, default: 0, min: 0 },
      esi: { type: Number, default: 0, min: 0 },
      professionalTax: { type: Number, default: 0, min: 0 },
      tds: { type: Number, default: 0, min: 0 },
      advanceSalary: { type: Number, default: 0, min: 0 },
      otherDeductions: { type: Number, default: 0, min: 0 },
      totalDeductions: { type: Number, default: 0, min: 0 },
    },

    netSalary: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["UNPAID", "PAID"],
      default: "UNPAID",
      index: true,
    },

    paymentDate: {
      type: Date,
      default: null,
    },

    paymentMode: {
      type: String,
      enum: ["BANK_TRANSFER", "CASH", "CHEQUE", "UPI", ""],
      default: "",
    },

    paymentReference: {
      type: String,
      default: "",
      trim: true,
    },

    bankDetailsSnapshot: {
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      branch: { type: String, default: "" },
      panNo: { type: String, default: "" },
      uanNo: { type: String, default: "" },
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
    collection: "salary_slips",
  }
);

payrollSchema.index({ tenantId: 1, slipNumber: 1 }, { unique: true });
payrollSchema.index({ tenantId: 1, employeeId: 1, month: 1, year: 1 }, { unique: true });
payrollSchema.index({ tenantId: 1, month: 1, year: 1 });
payrollSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model("SalarySlip", payrollSchema);
