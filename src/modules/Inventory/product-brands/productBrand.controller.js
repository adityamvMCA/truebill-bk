// const service = require("./productBrand.service");
// const { importProductBrands } = require("./productBrand.import");

// const getContext = (req) => ({
//   tenant: req.tenant,
//   userId: req.user.userId,
//   ipAddress: req.ip,
//   brandId: req.validatedParams?.brandId,
//   payload: req.validatedBody,
// });

// const createBrand = async (req, res, next) => {
//   try {
//     const data = await service.createBrand(getContext(req));

//     return res.status(201).json({
//       success: true,
//       message: "Product brand created successfully",
//       data,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// const listBrands = async (req, res, next) => {
//   try {
//     const result = await service.listBrands({
//       ...req.validatedQuery,
//       tenant: req.tenant,
//     });

//     return res.status(200).json({
//       success: true,
//       data: result.data,
//       pagination: result.pagination,
//       counts: result.counts,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// const getBrand = async (req, res, next) => {
//   try {
//     const data = await service.getBrand(getContext(req));

//     return res.status(200).json({
//       success: true,
//       data,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// const updateBrand = async (req, res, next) => {
//   try {
//     const data = await service.updateBrand(getContext(req));

//     return res.status(200).json({
//       success: true,
//       message: "Product brand updated successfully",
//       data,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// const bulkUpdateStatus = async (req, res, next) => {
//   try {
//     const result = await service.bulkUpdateStatus({
//       tenant: req.tenant,
//       userId: req.user.userId,
//       ipAddress: req.ip,
//       ...req.validatedBody,
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Product brands updated successfully",
//       data: result,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// const importBrands = async (req, res, next) => {
//   try {
//     const result = await importProductBrands({
//       ...getContext(req),
//       rows: req.body?.rows,
//     });

//     return res.status(200).json({
//       success: !result.requiresVerification,
//       ...result,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// const seedDefaults = async (req, res, next) => {
//   try {
//     const data = await service.seedDefaults({
//       ...getContext(req),
//       confirm: req.validatedBody.confirm,
//     });

//     return res.status(200).json({
//       success: true,
//       message:
//         "Tenant brand defaults seeded without overwriting existing values",
//       data,
//     });
//   } catch (error) {
//     return next(error);
//   }
// };

// module.exports = {
//   createBrand,
//   listBrands,
//   getBrand,
//   updateBrand,
//   bulkUpdateStatus,
//   importBrands,
//   seedDefaults,
// };


const service = require("./productBrand.service");

const {
  importProductBrands,
} = require("./productBrand.import");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
  brandId: req.validatedParams?.brandId,
  payload: req.validatedBody,
});

const createBrand = async (req, res, next) => {
  try {
    const data = await service.createBrand(getContext(req));

    return res.status(201).json({
      success: true,
      message: "Product brand created successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const listBrands = async (req, res, next) => {
  try {
    const result = await service.listBrands({
      ...req.validatedQuery,
      tenant: req.tenant,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      counts: result.counts,
    });
  } catch (error) {
    return next(error);
  }
};

const getBrand = async (req, res, next) => {
  try {
    const data = await service.getBrand(getContext(req));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const updateBrand = async (req, res, next) => {
  try {
    const data = await service.updateBrand(getContext(req));

    return res.status(200).json({
      success: true,
      message: "Product brand updated successfully",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

const importBrands = async (req, res, next) => {
  try {
    const result = await importProductBrands({
      ...getContext(req),
      rows: req.body?.rows,
    });

    return res.status(200).json({
      success: !result.requiresVerification,
      ...result,
      message:
        result.message ||
        "Import completed; check row results",
    });
  } catch (error) {
    return next(error);
  }
};

const bulkUpdateStatus = async (req, res, next) => {
  try {
    const result = await service.bulkUpdateStatus({
      ...req.validatedBody,
      tenant: req.tenant,
      userId: req.user.userId,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: "Brand statuses updated successfully",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

const seedDefaults = async (req, res, next) => {
  try {
    const data = await service.seedDefaults({
      ...getContext(req),
      confirm: req.validatedBody.confirm,
    });

    return res.status(200).json({
      success: true,
      message:
        "Tenant brand defaults seeded without overwriting existing values",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createBrand,
  listBrands,
  getBrand,
  updateBrand,
  importBrands,
  bulkUpdateStatus,
  seedDefaults,
};
