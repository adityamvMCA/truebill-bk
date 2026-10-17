// const supplierPaymentService = require(
//   "./supplierPayment.service",
// );

// const getContext = (req) => ({
//   tenantId: req.tenantId,
//   userId: req.user.userId,
//   ipAddress: req.ip,
// });

// const createSupplierPayment = async (req, res, next) => {
//   try {
//     const result =
//       await supplierPaymentService.createSupplierPayment({
//         ...getContext(req),
//         payload: req.body,
//       });

//     return res.status(result.replayed ? 200 : 201).json({
//       success: true,
//       message: result.replayed
//         ? "This supplier payment was already recorded"
//         : "Supplier payment recorded successfully",
//       replayed: result.replayed,
//       payment: result.payment,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getSupplierPayments = async (req, res, next) => {
//   try {
//     const result =
//       await supplierPaymentService.getSupplierPayments({
//         ...(req.validatedQuery || {}),
//         tenantId: req.tenantId,
//       });

//     return res.status(200).json({
//       success: true,
//       data: result.data,
//       pagination: result.pagination,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getSupplierPaymentByNumber = async (req, res, next) => {
//   try {
//     const payment =
//       await supplierPaymentService.getSupplierPaymentByNumber({
//         tenantId: req.tenantId,
//         paymentNumber:
//           req.validatedParams?.paymentNumber ||
//           req.params.paymentNumber,
//       });

//     return res.status(200).json({
//       success: true,
//       payment,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getUnpaidSupplierBills = async (req, res, next) => {
//   try {
//     const result =
//       await supplierPaymentService.getUnpaidSupplierBills({
//         ...(req.validatedQuery || {}),
//         tenantId: req.tenantId,
//       });

//     return res.status(200).json({
//       success: true,
//       data: result.data,
//       pagination: result.pagination,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getPaymentLedgers = async (req, res, next) => {
//   try {
//     const ledgers =
//       await supplierPaymentService.getPaymentLedgers({
//         tenantId: req.tenantId,
//       });

//     return res.status(200).json({
//       success: true,
//       total: ledgers.length,
//       data: ledgers,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// module.exports = {
//   createSupplierPayment,
//   getSupplierPayments,
//   getSupplierPaymentByNumber,
//   getUnpaidSupplierBills,
//   getPaymentLedgers,
// };

const supplierPaymentService = require(
  "./supplierPayment.service",
);

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const createSupplierPayment = async (req, res, next) => {
  try {
    const result =
      await supplierPaymentService.createSupplierPayment({
        ...getContext(req),
        payload: req.body,
      });

    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed
        ? "This supplier payment was already recorded"
        : "Supplier payment recorded successfully",
      replayed: result.replayed,
      payment: result.payment,
    });
  } catch (error) {
    next(error);
  }
};

const getSupplierPayments = async (req, res, next) => {
  try {
    const result =
      await supplierPaymentService.getSupplierPayments({
        ...(req.validatedQuery || {}),
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

const getSupplierPaymentByNumber = async (req, res, next) => {
  try {
    const payment =
      await supplierPaymentService.getSupplierPaymentByNumber({
        tenant: req.tenant,
        paymentNumber:
          req.validatedParams?.paymentNumber ||
          req.params.paymentNumber,
      });

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    next(error);
  }
};

const getUnpaidSupplierBills = async (req, res, next) => {
  try {
    const result =
      await supplierPaymentService.getUnpaidSupplierBills({
        ...(req.validatedQuery || {}),
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

const getPaymentLedgers = async (req, res, next) => {
  try {
    const ledgers =
      await supplierPaymentService.getPaymentLedgers({
        tenant: req.tenant,
      });

    return res.status(200).json({
      success: true,
      total: ledgers.length,
      data: ledgers,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSupplierPayment,
  getSupplierPayments,
  getSupplierPaymentByNumber,
  getUnpaidSupplierBills,
  getPaymentLedgers,
};