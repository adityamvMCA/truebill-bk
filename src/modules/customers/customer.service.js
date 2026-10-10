const Customer = require("./customer.model");
const AuditLog = require("../../models/AuditLog");
const { getNextSequence } = require("../../utils/sequenceGenerator");

const createCustomer = async ({
  tenantId,
  userId,
  payload,
  ipAddress,
}) => {
  const customerCode = await getNextSequence(
    "CU",
    tenantId.toString()
  );

  const customer = await Customer.create({
    ...payload,
    customerCode,
    tenantId,
  });

  await AuditLog.create({
    tenantId,
    userId,
    action: "CREATE",
    module: "CUSTOMER",
    documentId: customer._id,
    newData: customer.toObject(),
    ipAddress,
  });

  return customer;
};

const getCustomers = async ({
  tenantId,
  search = "",
  status,
  page = 1,
  limit = 20,
}) => {
  const currentPage = Math.max(Number(page) || 1, 1);
  const pageLimit = Math.min(
    Math.max(Number(limit) || 20, 1),
    100
  );

  const filter = {
    tenantId,
    isDeleted: false,
  };

  if (status) {
    filter.status = status;
  }

  const searchText = String(search || "").trim();

  if (searchText) {
    filter.$or = [
      {
        customerName: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        customerCode: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        phone: {
          $regex: searchText,
          $options: "i",
        },
      },
      {
        email: {
          $regex: searchText,
          $options: "i",
        },
      },
    ];
  }

  const [data, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * pageLimit)
      .limit(pageLimit)
      .lean(),

    Customer.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit),
    },
  };
};
const getCustomerById = async ({
  tenantId,
  customerCode,
}) => {
  return Customer.findOne({
    customerCode: String(customerCode).trim().toUpperCase(),
    tenantId,
    isDeleted: false,
  });
};
const updateCustomer = async ({
  tenantId,
  userId,
  customerCode,
  payload,
  ipAddress,
}) => {
  const customer = await Customer.findOne({
    customerCode: String(customerCode).trim().toUpperCase(),
    tenantId,
    isDeleted: false,
  });

  if (!customer) {
    const error = new Error("Customer not found");
    error.statusCode = 404;
    throw error;
  }

  const oldData = customer.toObject();

  const protectedFields = [
    "_id",
    "tenantId",
    "customerCode",
    "ledgerId",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdAt",
    "updatedAt",
    "__v",
  ];

  for (const [key, value] of Object.entries(payload || {})) {
    if (!protectedFields.includes(key)) {
      customer[key] = value;
    }
  }

  await customer.save();

  await AuditLog.create({
    tenantId,
    userId,
    action: "UPDATE",
    module: "CUSTOMER",
    documentId: customer._id,
    oldData,
    newData: customer.toObject(),
    ipAddress,
  });

  return customer;
};

const deleteCustomer = async ({
  tenantId,
  userId,
  customerCode,
  ipAddress,
}) => {
  const customer = await Customer.findOne({
    customerCode: String(customerCode).trim().toUpperCase(),
    tenantId,
    isDeleted: false,
  });

  if (!customer) {
    const error = new Error("Customer not found");
    error.statusCode = 404;
    throw error;
  }

  const oldData = customer.toObject();

  customer.isDeleted = true;
  customer.deletedAt = new Date();
  customer.deletedBy = userId;

  await customer.save();

  await AuditLog.create({
    tenantId,
    userId,
    action: "DELETE",
    module: "CUSTOMER",
    documentId: customer._id,
    oldData,
    newData: customer.toObject(),
    ipAddress,
  });

  return customer;
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};