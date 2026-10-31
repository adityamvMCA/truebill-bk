const customerService = require("./customer.service");

const createCustomer = async (req, res, next) => {
  try {
    const customer = await customerService.createCustomer({
      tenant: req.tenant,
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
    const {
      search,
      status,
      customerType,
      openingBalanceType,
      sortBy,
      sortOrder,
      page,
      limit,
    } = req.query;

    const result = await customerService.getCustomers({
      tenant: req.tenant,
      search,
      status,
      customerType,
      openingBalanceType,
      sortBy,
      sortOrder,
      page,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getCustomerStats = async (req, res, next) => {
  try {
    const stats = await customerService.getCustomerStats({
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

const getCustomerById = async (req, res, next) => {
  try {
    const customer = await customerService.getCustomerById({
      tenant: req.tenant,
      customerCode: req.params.customerCode,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
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
      tenant: req.tenant,
      userId: req.user.userId,
      customerCode: req.params.customerCode,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      customer,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    await customerService.deleteCustomer({
      tenant: req.tenant,
      userId: req.user.userId,
      customerCode: req.params.customerCode,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Customer deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
const bulkUpdateCustomerStatus = async (req, res, next) => {
  try {
    const result = await customerService.bulkUpdateStatus({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  createCustomer,
  getCustomers,
  getCustomerStats,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  bulkUpdateCustomerStatus
};