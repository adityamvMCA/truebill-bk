const Customer = require("../models/Customer");
const AuditLog = require("../models/AuditLog");
const { getNextSequence } = require("../utils/sequenceGenerator");
const createCustomer = async (req, res) => {
  const customer = await Customer.create({
    ...req.body,
    customerCode: await getNextSequence("CU", req.tenantId.toString()),
    tenantId: req.tenantId,
  });
  await AuditLog.create({
    tenantId: req.tenantId,
    userId: req.user.userId,
    action: "CREATE",
    module: "CUSTOMER",
    documentId: customer._id,
    newData: customer.toObject(),
    ipAddress: req.ip,
  });
  res
    .status(201)
    .json({
      success: true,
      message: "Customer created successfully",
      customer,
    });
};
const getCustomers = async (req, res) => {
  const { search = "", status, page = 1, limit = 20 } = req.query;
  const p = Math.max(Number(page) || 1, 1),
    l = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const filter = { tenantId: req.tenantId, isDeleted: false };
  if (status) filter.status = status;
  if (search.trim())
    filter.$or = [
      { customerName: { $regex: search.trim(), $options: "i" } },
      { customerCode: { $regex: search.trim(), $options: "i" } },
      { phone: { $regex: search.trim(), $options: "i" } },
    ];
  const [data, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean(),
    Customer.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  });
};
const getCustomerById = async (req, res) => {
  const customer = await Customer.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
    isDeleted: false,
  });
  if (!customer)
    return res
      .status(404)
      .json({ success: false, message: "Customer not found" });
  res.json({ success: true, customer });
};
const updateCustomer = async (req, res) => {
  const customer = await Customer.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
    isDeleted: false,
  });
  if (!customer)
    return res
      .status(404)
      .json({ success: false, message: "Customer not found" });
  const oldData = customer.toObject();
  const protectedFields = [
    "_id",
    "tenantId",
    "customerCode",
    "isDeleted",
    "deletedAt",
    "deletedBy",
  ];
  for (const [k, v] of Object.entries(req.body))
    if (!protectedFields.includes(k)) customer[k] = v;
  await customer.save();
  await AuditLog.create({
    tenantId: req.tenantId,
    userId: req.user.userId,
    action: "UPDATE",
    module: "CUSTOMER",
    documentId: customer._id,
    oldData,
    newData: customer.toObject(),
    ipAddress: req.ip,
  });
  res.json({
    success: true,
    message: "Customer updated successfully",
    customer,
  });
};
const deleteCustomer = async (req, res) => {
  const customer = await Customer.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
    isDeleted: false,
  });
  if (!customer)
    return res
      .status(404)
      .json({ success: false, message: "Customer not found" });
  customer.isDeleted = true;
  customer.deletedAt = new Date();
  customer.deletedBy = req.user.userId;
  await customer.save();
  await AuditLog.create({
    tenantId: req.tenantId,
    userId: req.user.userId,
    action: "DELETE",
    module: "CUSTOMER",
    documentId: customer._id,
    oldData: customer.toObject(),
    ipAddress: req.ip,
  });
  res.json({ success: true, message: "Customer deleted successfully" });
};
module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};
