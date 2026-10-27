// const supplierService = require("./supplier.service");

// const createSupplier = async (req, res, next) => {
//   try {
//     const supplier = await supplierService.createSupplier({
//       tenant: req.tenant,
//       userId: req.user.userId,
//       payload: req.body,
//       ipAddress: req.ip,
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Supplier created successfully",
//       supplier,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getSuppliers = async (req, res, next) => {
//   try {
//     const result = await supplierService.getSuppliers({
//       ...req.query,
//       tenant: req.tenant,
//     });

//     return res.status(200).json({
//       success: true,
//       data: result.data,
//       pagination: result.pagination,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getSupplierByCode = async (req, res, next) => {
//   try {
//     const supplier = await supplierService.getSupplierByCode({
//       tenant: req.tenant,
//       supplierCode: req.params.supplierCode,
//     });

//     if (!supplier) {
//       return res.status(404).json({
//         success: false,
//         message: "Supplier not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       supplier,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const updateSupplier = async (req, res, next) => {
//   try {
//     const supplier = await supplierService.updateSupplier({
//       tenant: req.tenant,
//       userId: req.user.userId,
//       supplierCode: req.params.supplierCode,
//       payload: req.body,
//       ipAddress: req.ip,
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Supplier updated successfully",
//       supplier,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const deleteSupplier = async (req, res, next) => {
//   try {
//     await supplierService.deleteSupplier({
//       tenant: req.tenant,
//       userId: req.user.userId,
//       supplierCode: req.params.supplierCode,
//       ipAddress: req.ip,
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Supplier deleted successfully",
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// module.exports = {
//   createSupplier,
//   getSuppliers,
//   getSupplierByCode,
//   updateSupplier,
//   deleteSupplier,
// };

const supplierService = require("./supplier.service");

const createSupplier = async (req, res, next) => {
  try {
    const supplier = await supplierService.createSupplier({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.body,
      ipAddress: req.ip,
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

const getSuppliers = async (req, res, next) => {
  try {
    const {
      search,
      status,
      supplierType,
      openingBalanceType,
      state,
      sortBy,
      sortOrder,
      page,
      limit,
    } = req.query;

    const result = await supplierService.getSuppliers({
      tenant: req.tenant,
      search,
      status,
      supplierType,
      openingBalanceType,
      state,
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

const getSupplierStats = async (req, res, next) => {
  try {
    const stats = await supplierService.getSupplierStats({
      tenant: req.tenant,
    });

    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

const getSupplierByCode = async (req, res, next) => {
  try {
    const supplier = await supplierService.getSupplierByCode({
      tenant: req.tenant,
      supplierCode: req.params.supplierCode,
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    return res.status(200).json({ success: true, supplier });
  } catch (error) {
    next(error);
  }
};

const updateSupplier = async (req, res, next) => {
  try {
    const supplier = await supplierService.updateSupplier({
      tenant: req.tenant,
      userId: req.user.userId,
      supplierCode: req.params.supplierCode,
      payload: req.body,
      ipAddress: req.ip,
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
    await supplierService.deleteSupplier({
      tenant: req.tenant,
      userId: req.user.userId,
      supplierCode: req.params.supplierCode,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Supplier deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSupplier,
  getSuppliers,
  getSupplierStats,
  getSupplierByCode,
  updateSupplier,
  deleteSupplier,
};