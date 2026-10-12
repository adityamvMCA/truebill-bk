const supplierService = require("./supplier.service");

const getSuppliers = async (req, res, next) => {
  try {
    const result =
      await supplierService.getSuppliers({
        tenantId: req.tenantId,
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search,
        status: req.query.status,
        supplierType: req.query.supplierType,
        state: req.query.state,
      });

    return res.status(200).json({
      success: true,

      data: {
        suppliers: result.suppliers,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getSupplierByCode = async (
  req,
  res,
  next
) => {
  try {
    const supplier =
      await supplierService.getSupplierByCode({
        tenantId: req.tenantId,
        supplierCode: req.params.supplierCode,
      });

    return res.status(200).json({
      success: true,
      supplier,
    });
  } catch (error) {
    next(error);
  }
};

const createSupplier = async (req, res, next) => {
  try {
    const supplier =
      await supplierService.createSupplier({
        tenantId: req.tenantId,
        userId: req.user.userId,
        body: req.body,
      });

    return res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      supplier,
    });
  } catch (error) {
    next(error);
  }
};

const updateSupplier = async (req, res, next) => {
  try {
    const supplier =
      await supplierService.updateSupplier({
        tenantId: req.tenantId,
        userId: req.user.userId,
        supplierCode: req.params.supplierCode,
        body: req.body,
      });

    return res.status(200).json({
      success: true,
      message: "Supplier updated successfully",
      supplier,
    });
  } catch (error) {
    next(error);
  }
};

const deleteSupplier = async (req, res, next) => {
  try {
    const supplier =
      await supplierService.deleteSupplier({
        tenantId: req.tenantId,
        userId: req.user.userId,
        supplierCode: req.params.supplierCode,
      });

    return res.status(200).json({
      success: true,
      message: "Supplier deleted successfully",
      supplier,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSuppliers,
  getSupplierByCode,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};