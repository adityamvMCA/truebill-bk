const employeeService = require("./employee.service");
const payrollService = require("./payroll.service");

// --- EMPLOYEE CONTROLLERS ---

const createEmployee = async (req, res, next) => {
  try {
    const employee = await employeeService.createEmployee({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.body,
    });
    return res.status(201).json({
      success: true,
      message: "Employee created successfully",
      employee,
    });
  } catch (err) {
    next(err);
  }
};

const getEmployees = async (req, res, next) => {
  try {
    const result = await employeeService.getEmployees({
      tenant: req.tenant,
      query: req.query,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

const getEmployeeById = async (req, res, next) => {
  try {
    const employee = await employeeService.getEmployeeById({
      tenant: req.tenant,
      id: req.params.id,
    });
    return res.json({ success: true, employee });
  } catch (err) {
    next(err);
  }
};

const updateEmployee = async (req, res, next) => {
  try {
    const employee = await employeeService.updateEmployee({
      tenant: req.tenant,
      userId: req.user.userId,
      id: req.params.id,
      payload: req.body,
    });
    return res.json({
      success: true,
      message: "Employee updated successfully",
      employee,
    });
  } catch (err) {
    next(err);
  }
};

const deleteEmployee = async (req, res, next) => {
  try {
    const result = await employeeService.deleteEmployee({
      tenant: req.tenant,
      userId: req.user.userId,
      id: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

// --- PAYROLL CONTROLLERS ---

const generatePayroll = async (req, res, next) => {
  try {
    const { month, year, workingDays } = req.body;
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and Year are required to generate payroll",
      });
    }

    const result = await payrollService.generateMonthlyPayroll({
      tenant: req.tenant,
      userId: req.user.userId,
      month,
      year,
      workingDays,
    });

    return res.status(201).json({
      success: true,
      message: `Payroll generated successfully for ${result.period}`,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

const getSalarySlips = async (req, res, next) => {
  try {
    const result = await payrollService.getSalarySlips({
      tenant: req.tenant,
      query: req.query,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

const getSalarySlipById = async (req, res, next) => {
  try {
    const slip = await payrollService.getSalarySlipById({
      tenant: req.tenant,
      id: req.params.id,
    });
    return res.json({ success: true, slip });
  } catch (err) {
    next(err);
  }
};

const markSalaryPaid = async (req, res, next) => {
  try {
    const slip = await payrollService.markSalaryPaid({
      tenant: req.tenant,
      userId: req.user.userId,
      id: req.params.id,
      payload: req.body,
    });
    return res.json({
      success: true,
      message: "Salary marked as paid successfully",
      slip,
    });
  } catch (err) {
    next(err);
  }
};

const deleteSalarySlip = async (req, res, next) => {
  try {
    const result = await payrollService.deleteSalarySlip({
      tenant: req.tenant,
      userId: req.user.userId,
      id: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  generatePayroll,
  getSalarySlips,
  getSalarySlipById,
  markSalaryPaid,
  deleteSalarySlip,
};
