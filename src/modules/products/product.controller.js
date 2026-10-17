// const productService = require("./product.service");

// const createProduct = async (req, res, next) => {
//   try {
//     const product = await productService.createProduct({
//       tenantId: req.tenantId,
//       userId: req.user.userId,
//       payload: req.body,
//       ipAddress: req.ip,
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Product created successfully",
//       product,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getProducts = async (req, res, next) => {
//   try {
//     const result = await productService.getProducts({
//       tenantId: req.tenantId,
//       ...req.query,
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

// const getProductByCode = async (req, res, next) => {
//   try {
//     const product = await productService.getProductByCode({
//       tenantId: req.tenantId,
//       productCode: req.params.productCode,
//     });

//     if (!product) {
//       return res.status(404).json({
//         success: false,
//         message: "Product not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       product,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const updateProduct = async (req, res, next) => {
//   try {
//     const product = await productService.updateProduct({
//       tenantId: req.tenantId,
//       userId: req.user.userId,
//       productCode: req.params.productCode,
//       payload: req.body,
//       ipAddress: req.ip,
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Product updated successfully",
//       product,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const deleteProduct = async (req, res, next) => {
//   try {
//     await productService.deleteProduct({
//       tenantId: req.tenantId,
//       userId: req.user.userId,
//       productCode: req.params.productCode,
//       ipAddress: req.ip,
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Product deleted successfully",
//     });
//   } catch (error) {
//     next(error);
//   }
// };
// const importProducts = async (
//   req,
//   res,
//   next
// ) => {
//   try {
//     if (!req.file?.buffer) {
//       return res.status(400).json({
//         success: false,
//         message: "CSV file is required",
//       });
//     }

//     const result =
//       await productService.importProducts({
//         tenantId: req.tenantId,
//         userId: req.user.userId,
//         buffer: req.file.buffer,
//         ipAddress: req.ip,
//       });

//     return res.status(200).json({
//       success: true,
//       message: `Imported ${result.successCount} product(s) successfully`,
//       totalRows: result.totalRows,
//       createdCount: result.successCount,
//       failedCount: result.failureCount,
//       errors: result.errors,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// module.exports = {
//   createProduct,
//   getProducts,
//   getProductByCode,
//   updateProduct,
//   deleteProduct,
//   importProducts
// };
// 

const productService = require("./product.service");

const createProduct = async (req, res, next) => {
  try {
    const product = await productService.createProduct({
      tenant: req.tenant,
      userId: req.user.userId,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    next(error);
  }
};

const getProducts = async (req, res, next) => {
  try {
    const result = await productService.getProducts({
      ...req.query,
      tenant: req.tenant,
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

const getProductByCode = async (req, res, next) => {
  try {
    const product = await productService.getProductByCode({
      tenant: req.tenant,
      productCode: req.params.productCode,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const product = await productService.updateProduct({
      tenant: req.tenant,
      userId: req.user.userId,
      productCode: req.params.productCode,
      payload: req.body,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product,
    });
  } catch (error) {
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    await productService.deleteProduct({
      tenant: req.tenant,
      userId: req.user.userId,
      productCode: req.params.productCode,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const importProducts = async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        success: false,
        message: "CSV file is required",
      });
    }

    const result = await productService.importProducts({
      tenant: req.tenant,
      userId: req.user.userId,
      buffer: req.file.buffer,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: `Imported ${result.successCount} product(s) successfully`,
      totalRows: result.totalRows,
      createdCount: result.successCount,
      failedCount: result.failureCount,
      errors: result.errors,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductByCode,
  updateProduct,
  deleteProduct,
  importProducts,
};
