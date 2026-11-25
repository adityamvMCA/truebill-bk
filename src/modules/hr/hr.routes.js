const express = require("express");
const hr = require("./hr.controller");
const verifyToken = require("../../middleware/authMiddleware");
const resolveTenant = require("../../middleware/tenantMiddleware");

const router = express.Router();

router.use(verifyToken, resolveTenant);

// Employee routes
router.get("/employees", hr.getEmployees);
router.post("/employees", hr.createEmployee);
router.get("/employees/:id", hr.getEmployeeById);
router.put("/employees/:id", hr.updateEmployee);
router.delete("/employees/:id", hr.deleteEmployee);

// Payroll & Salary Slip routes
router.get("/payroll", hr.getSalarySlips);
router.post("/payroll/generate", hr.generatePayroll);
router.get("/payroll/:id", hr.getSalarySlipById);
router.put("/payroll/:id/pay", hr.markSalaryPaid);
router.delete("/payroll/:id", hr.deleteSalarySlip);

module.exports = router;
