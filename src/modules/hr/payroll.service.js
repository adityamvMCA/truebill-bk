const mongoose = require("mongoose");
const SalarySlip = require("./payroll.model");
const Employee = require("./employee.model");
const Ledger = require("../accounting/ledgers/ledger.model");
const LedgerGroup = require("../accounting/ledger-groups/ledgerGroup.model");
const { getTenantAccountingModels } = require("../../tenancy/tenantAccountingModels");
const { getReadyTenantConnection } = require("../../tenancy/tenantConnectionManager");

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const resolveModels = (tenant) => {
  try {
    const connection = getReadyTenantConnection(tenant);
    return getTenantAccountingModels(connection);
  } catch {
    return { Ledger, LedgerGroup };
  }
};

/**
 * Generate monthly payroll for all active employees of a tenant.
 */
const generateMonthlyPayroll = async ({ tenant, userId, month, year, workingDays = 30 }) => {
  const tenantId = tenant._id || tenant.id;
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  const period = `${MONTH_NAMES[m]} ${y}`;

  const activeEmployees = await Employee.find({
    tenantId,
    status: "Active",
    isDeleted: false,
  });

  if (!activeEmployees.length) {
    const error = new Error("No active employees found to generate payroll.");
    error.statusCode = 400;
    throw error;
  }

  const generatedSlips = [];
  let slipIndex = 1;

  for (const emp of activeEmployees) {
    const struct = emp.salaryStructure || {};
    const slipNumber = `PAY-${y}${String(m).padStart(2, "0")}-${String(slipIndex).padStart(3, "0")}`;
    slipIndex += 1;

    const earnings = {
      basic: Number(struct.basicSalary) || 0,
      hra: Number(struct.hra) || 0,
      conveyance: Number(struct.conveyance) || 0,
      specialAllowance: Number(struct.specialAllowance) || 0,
      medical: Number(struct.medicalAllowance) || 0,
      bonus: 0,
      overtime: 0,
      totalEarnings: Number(struct.grossSalary) || 0,
    };

    const deductions = {
      epf: Number(struct.epfDeduction) || 0,
      esi: Number(struct.esiDeduction) || 0,
      professionalTax: Number(struct.professionalTax) || 0,
      tds: Number(struct.tdsDeduction) || 0,
      advanceSalary: 0,
      otherDeductions: 0,
      totalDeductions:
        (Number(struct.epfDeduction) || 0) +
        (Number(struct.esiDeduction) || 0) +
        (Number(struct.professionalTax) || 0) +
        (Number(struct.tdsDeduction) || 0),
    };

    const netSalary = Math.max(0, earnings.totalEarnings - deductions.totalDeductions);

    // Update if already exists, else insert
    const slip = await SalarySlip.findOneAndUpdate(
      {
        tenantId,
        employeeId: emp._id,
        month: m,
        year: y,
      },
      {
        tenantId,
        slipNumber,
        employeeId: emp._id,
        employeeCode: emp.employeeCode,
        employeeName: emp.name,
        designation: emp.designation,
        department: emp.department,
        month: m,
        year: y,
        period,
        workingDays: Number(workingDays) || 30,
        presentDays: Number(workingDays) || 30,
        paidLeaves: 0,
        unpaidLeaves: 0,
        earnings,
        deductions,
        netSalary,
        bankDetailsSnapshot: {
          bankName: emp.bankDetails?.bankName || "",
          accountNumber: emp.bankDetails?.accountNumber || "",
          ifscCode: emp.bankDetails?.ifscCode || "",
          branch: emp.bankDetails?.branch || "",
          panNo: emp.panNo || "",
          uanNo: emp.uanNo || "",
        },
        createdBy: userId,
        updatedBy: userId,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    generatedSlips.push(slip);
  }

  return {
    success: true,
    period,
    count: generatedSlips.length,
    slips: generatedSlips,
  };
};

const getSalarySlips = async ({ tenant, query }) => {
  const tenantId = tenant._id || tenant.id;
  const {
    month,
    year,
    employeeId,
    status,
    search = "",
    page = 1,
    limit = 50,
  } = query;

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (month) filter.month = parseInt(month, 10);
  if (year) filter.year = parseInt(year, 10);
  if (employeeId) filter.employeeId = employeeId;
  if (status) filter.status = status;

  if (search) {
    filter.$or = [
      { employeeName: { $regex: search, $options: "i" } },
      { employeeCode: { $regex: search, $options: "i" } },
      { slipNumber: { $regex: search, $options: "i" } },
      { department: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const total = await SalarySlip.countDocuments(filter);
  const slips = await SalarySlip.find(filter)
    .populate("employeeId", "name employeeCode email phone bankDetails panNo aadhaarNo uanNo dateOfJoining")
    .sort({ year: -1, month: -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10))
    .lean();

  // Summary aggregation for current filter
  const summaryAgg = await SalarySlip.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalNet: { $sum: "$netSalary" },
        totalGross: { $sum: "$earnings.totalEarnings" },
        totalDeductions: { $sum: "$deductions.totalDeductions" },
        paidCount: {
          $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] },
        },
        unpaidCount: {
          $sum: { $cond: [{ $eq: ["$status", "UNPAID"] }, 1, 0] },
        },
      },
    },
  ]);

  const summary = summaryAgg[0] || {
    totalNet: 0,
    totalGross: 0,
    totalDeductions: 0,
    paidCount: 0,
    unpaidCount: 0,
  };

  return {
    slips,
    summary,
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
  };
};

const getSalarySlipById = async ({ tenant, id }) => {
  const tenantId = tenant._id || tenant.id;
  const slip = await SalarySlip.findOne({
    _id: id,
    tenantId,
    isDeleted: false,
  }).populate("employeeId");

  if (!slip) {
    const error = new Error("Salary slip not found");
    error.statusCode = 404;
    throw error;
  }

  return slip;
};

const markSalaryPaid = async ({ tenant, userId, id, payload }) => {
  const tenantId = tenant._id || tenant.id;
  const models = resolveModels(tenant);

  const slip = await SalarySlip.findOne({ _id: id, tenantId, isDeleted: false });
  if (!slip) {
    const error = new Error("Salary slip not found");
    error.statusCode = 404;
    throw error;
  }

  slip.status = "PAID";
  slip.paymentDate = payload.paymentDate || new Date();
  slip.paymentMode = payload.paymentMode || "BANK_TRANSFER";
  slip.paymentReference = payload.paymentReference || "";
  slip.updatedBy = userId;
  await slip.save();

  // Optional: update employee ledger balance
  try {
    const L = models.Ledger || Ledger;
    await L.updateOne(
      { tenantId, referenceType: "EMPLOYEE", referenceId: slip.employeeId },
      { $inc: { currentBalance: -slip.netSalary } }
    );
  } catch (err) {
    console.warn("Could not update employee ledger balance:", err.message);
  }

  return slip;
};

const deleteSalarySlip = async ({ tenant, userId, id }) => {
  const tenantId = tenant._id || tenant.id;
  const slip = await SalarySlip.findOne({ _id: id, tenantId, isDeleted: false });
  if (!slip) {
    const error = new Error("Salary slip not found");
    error.statusCode = 404;
    throw error;
  }

  slip.isDeleted = true;
  slip.updatedBy = userId;
  await slip.save();

  return { success: true, message: "Salary slip removed successfully" };
};

module.exports = {
  generateMonthlyPayroll,
  getSalarySlips,
  getSalarySlipById,
  markSalaryPaid,
  deleteSalarySlip,
};
