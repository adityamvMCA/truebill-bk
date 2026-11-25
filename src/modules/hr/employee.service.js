const mongoose = require("mongoose");
const Employee = require("./employee.model");
const Ledger = require("../accounting/ledgers/ledger.model");
const LedgerGroup = require("../accounting/ledger-groups/ledgerGroup.model");
const { getTenantAccountingModels } = require("../../tenancy/tenantAccountingModels");
const { getReadyTenantConnection } = require("../../tenancy/tenantConnectionManager");

const computeSalaries = (structure = {}) => {
  const basic = Number(structure.basicSalary) || 0;
  const hra = Number(structure.hra) || 0;
  const conveyance = Number(structure.conveyance) || 0;
  const specialAllowance = Number(structure.specialAllowance) || 0;
  const medicalAllowance = Number(structure.medicalAllowance) || 0;

  const grossSalary = basic + hra + conveyance + specialAllowance + medicalAllowance;

  const epf = Number(structure.epfDeduction) || 0;
  const esi = Number(structure.esiDeduction) || 0;
  const pt = Number(structure.professionalTax) || 0;
  const tds = Number(structure.tdsDeduction) || 0;

  const totalDeductions = epf + esi + pt + tds;
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  return {
    basicSalary: basic,
    hra,
    conveyance,
    specialAllowance,
    medicalAllowance,
    epfDeduction: epf,
    esiDeduction: esi,
    professionalTax: pt,
    tdsDeduction: tds,
    grossSalary,
    netSalary,
  };
};

const resolveModels = (tenant) => {
  try {
    const connection = getReadyTenantConnection(tenant);
    return getTenantAccountingModels(connection);
  } catch {
    return { Ledger, LedgerGroup };
  }
};

/**
 * Creates or retrieves the Salary Payable group in the tenant's chart of accounts.
 */
const getOrCreateSalaryPayableGroup = async ({ tenantId, models }) => {
  const LG = models.LedgerGroup || LedgerGroup;
  let group = await LG.findOne({
    tenantId,
    code: "SALARY_PAYABLE",
  });

  if (!group) {
    group = await LG.findOne({
      tenantId,
      name: { $regex: /salary|payroll|current liabilities/i },
    });
  }

  if (!group) {
    // Create SALARY_PAYABLE group under CURRENT_LIABILITIES
    group = await LG.create({
      tenantId,
      code: "SALARY_PAYABLE",
      name: "Salary Payable",
      nature: "LIABILITY",
      isSystem: true,
      description: "Employee salaries and payroll payable liabilities",
    });
  }

  return group;
};

/**
 * Create or sync Employee Ledger
 */
const syncEmployeeLedger = async ({ tenantId, employee, userId, models }) => {
  const L = models.Ledger || Ledger;
  const group = await getOrCreateSalaryPayableGroup({ tenantId, models });

  let ledger = await L.findOne({
    tenantId,
    referenceType: "EMPLOYEE",
    referenceId: employee._id,
  });

  const ledgerCode = `EMP-${employee.employeeCode || employee._id.toString().slice(-4).toUpperCase()}`;

  if (!ledger) {
    ledger = await L.create({
      tenantId,
      ledgerGroupId: group._id,
      code: ledgerCode,
      name: `${employee.name} (${employee.employeeCode || "EMP"})`,
      type: "EMPLOYEE",
      nature: "LIABILITY",
      normalBalance: "CREDIT",
      openingBalance: 0,
      currentBalance: 0,
      referenceType: "EMPLOYEE",
      referenceId: employee._id,
      isSystem: false,
      isActive: employee.status === "Active",
      description: `Salary & Payroll ledger for employee ${employee.name} (${employee.employeeCode})`,
      createdBy: userId,
      updatedBy: userId,
    });
  } else {
    ledger.name = `${employee.name} (${employee.employeeCode || "EMP"})`;
    ledger.isActive = employee.status === "Active";
    ledger.updatedBy = userId;
    await ledger.save();
  }

  return ledger;
};

const getNextEmployeeCode = async (tenantId) => {
  const lastEmp = await Employee.findOne({ tenantId })
    .sort({ createdAt: -1 })
    .lean();

  if (!lastEmp || !lastEmp.employeeCode) return "EMP-001";

  const numPart = lastEmp.employeeCode.replace(/\D/g, "");
  const nextNum = (parseInt(numPart, 10) || 0) + 1;
  return `EMP-${String(nextNum).padStart(3, "0")}`;
};

const createEmployee = async ({ tenant, userId, payload }) => {
  const tenantId = tenant._id || tenant.id;
  const models = resolveModels(tenant);

  let employeeCode = String(payload.employeeCode || "").trim().toUpperCase();
  if (!employeeCode) {
    employeeCode = await getNextEmployeeCode(tenantId);
  }

  const existing = await Employee.findOne({
    tenantId,
    employeeCode,
    isDeleted: false,
  });
  if (existing) {
    const error = new Error(`Employee code "${employeeCode}" already exists.`);
    error.statusCode = 400;
    throw error;
  }

  const salaryStructure = computeSalaries(payload.salaryStructure);

  const employee = new Employee({
    tenantId,
    employeeCode,
    name: payload.name,
    email: payload.email || "",
    phone: payload.phone || "",
    designation: payload.designation || "Staff",
    department: payload.department || "General",
    dateOfJoining: payload.dateOfJoining || new Date(),
    status: payload.status || "Active",
    panNo: payload.panNo || "",
    aadhaarNo: payload.aadhaarNo || "",
    uanNo: payload.uanNo || "",
    esiNo: payload.esiNo || "",
    bankDetails: payload.bankDetails || {},
    salaryStructure,
    userId: payload.userId || null,
    notes: payload.notes || "",
    createdBy: userId,
    updatedBy: userId,
  });

  await employee.save();

  // Create Accounting Ledger for the employee
  try {
    const ledger = await syncEmployeeLedger({
      tenantId,
      employee,
      userId,
      models,
    });
    employee.ledgerId = ledger._id;
    await employee.save();
  } catch (err) {
    console.warn("Could not create employee ledger automatically:", err.message);
  }

  return employee;
};

const getEmployees = async ({ tenant, query }) => {
  const tenantId = tenant._id || tenant.id;
  const {
    search = "",
    status,
    department,
    page = 1,
    limit = 50,
  } = query;

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) filter.status = status;
  if (department) filter.department = department;

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { employeeCode: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { designation: { $regex: search, $options: "i" } },
      { department: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const total = await Employee.countDocuments(filter);
  const employees = await Employee.find(filter)
    .populate("ledgerId", "name code currentBalance currentBalanceType")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10))
    .lean();

  return {
    employees,
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    pages: Math.ceil(total / parseInt(limit, 10)),
  };
};

const getEmployeeById = async ({ tenant, id }) => {
  const tenantId = tenant._id || tenant.id;
  const employee = await Employee.findOne({
    _id: id,
    tenantId,
    isDeleted: false,
  }).populate("ledgerId");

  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  return employee;
};

const updateEmployee = async ({ tenant, userId, id, payload }) => {
  const tenantId = tenant._id || tenant.id;
  const models = resolveModels(tenant);

  const employee = await Employee.findOne({ _id: id, tenantId, isDeleted: false });
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  if (payload.name) employee.name = payload.name;
  if (payload.email !== undefined) employee.email = payload.email;
  if (payload.phone !== undefined) employee.phone = payload.phone;
  if (payload.designation !== undefined) employee.designation = payload.designation;
  if (payload.department !== undefined) employee.department = payload.department;
  if (payload.dateOfJoining) employee.dateOfJoining = payload.dateOfJoining;
  if (payload.dateOfRelieving !== undefined) employee.dateOfRelieving = payload.dateOfRelieving;
  if (payload.status) employee.status = payload.status;
  if (payload.panNo !== undefined) employee.panNo = payload.panNo;
  if (payload.aadhaarNo !== undefined) employee.aadhaarNo = payload.aadhaarNo;
  if (payload.uanNo !== undefined) employee.uanNo = payload.uanNo;
  if (payload.esiNo !== undefined) employee.esiNo = payload.esiNo;
  if (payload.bankDetails) employee.bankDetails = { ...employee.bankDetails, ...payload.bankDetails };
  if (payload.notes !== undefined) employee.notes = payload.notes;

  if (payload.salaryStructure) {
    employee.salaryStructure = computeSalaries({
      ...employee.salaryStructure,
      ...payload.salaryStructure,
    });
  }

  employee.updatedBy = userId;
  await employee.save();

  // Sync Ledger name & status
  try {
    const ledger = await syncEmployeeLedger({ tenantId, employee, userId, models });
    if (!employee.ledgerId) {
      employee.ledgerId = ledger._id;
      await employee.save();
    }
  } catch (err) {
    console.warn("Could not sync employee ledger:", err.message);
  }

  return employee;
};

const deleteEmployee = async ({ tenant, userId, id }) => {
  const tenantId = tenant._id || tenant.id;
  const models = resolveModels(tenant);

  const employee = await Employee.findOne({ _id: id, tenantId, isDeleted: false });
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  employee.isDeleted = true;
  employee.status = "Inactive";
  employee.updatedBy = userId;
  await employee.save();

  // Deactivate Ledger
  if (employee.ledgerId) {
    const L = models.Ledger || Ledger;
    await L.updateOne({ _id: employee.ledgerId, tenantId }, { isActive: false, updatedBy: userId });
  }

  return { success: true, message: "Employee deleted successfully" };
};

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  computeSalaries,
};
