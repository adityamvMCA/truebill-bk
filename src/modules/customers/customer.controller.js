const customerService = require("./customer.service");

const createCustomer = async (req, res, next) => {
  try {
    const customer = await customerService.createCustomer({
      tenantId: req.tenantId,
      userId: req.user.userId,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      customer,
    });
  } catch (error) {
    next(error);
  }
};

const getCustomers = async (req, res, next) => {
  try {
    const result = await customerService.getCustomers({
      tenantId: req.tenantId,
      ...req.query,
    });

    return res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getCustomerById = async (req, res, next) => {
  try {
   const customer = await customerService.getCustomerById({
  tenantId: req.tenantId,
  customerCode: req.params.customerCode,
});

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.json({
      success: true,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const customer = await customerService.updateCustomer({
  tenantId: req.tenantId,
  userId: req.user.userId,
  customerCode: req.params.customerCode,
  payload: req.body,
  ipAddress: req.ip,
});

    return res.json({
      success: true,
      message: "Customer updated successfully",
      customer,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    await customerService.deleteCustomer({
  tenantId: req.tenantId,
  userId: req.user.userId,
  customerCode: req.params.customerCode,
  ipAddress: req.ip,
});

    return res.json({
      success: true,
      message: "Customer deleted successfully",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};