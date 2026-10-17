// const customerReceiptService = require("./customerReceipt.service");

// const getContext = (req) => ({
//   tenantId: req.tenantId,
//   userId: req.user.userId,
//   ipAddress: req.ip,
// });

// const createCustomerReceipt = async (req, res, next) => {
//   try {
//     const result = await customerReceiptService.createCustomerReceipt({
//       ...getContext(req),
//       payload: req.body,
//     });

//     return res.status(result.replayed ? 200 : 201).json({
//       success: true,
//       message: result.replayed
//         ? "This customer receipt was already recorded"
//         : "Customer receipt recorded successfully",
//       replayed: result.replayed,
//       receipt: result.receipt,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getCustomerReceipts = async (req, res, next) => {
//   try {
//     const result = await customerReceiptService.getCustomerReceipts({
//       ...(req.validatedQuery || {}),
//       tenantId: req.tenantId,
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

// const getCustomerReceiptByNumber = async (req, res, next) => {
//   try {
//     const receipt = await customerReceiptService.getCustomerReceiptByNumber({
//       tenantId: req.tenantId,
//       receiptNumber:
//         req.validatedParams?.receiptNumber || req.params.receiptNumber,
//     });

//     return res.status(200).json({
//       success: true,
//       receipt,
//     });
//   } catch (error) {
//     next(error);
//   }
// };

// const getUnpaidSalesInvoices = async (req, res, next) => {
//   try {
//     const result = await customerReceiptService.getUnpaidSalesInvoices({
//       ...(req.validatedQuery || {}),
//       tenantId: req.tenantId,
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

// const getReceiptLedgers = async (req, res, next) => {
//   try {
//     const ledgers = await customerReceiptService.getReceiptLedgers({
//       tenantId: req.tenantId,
//     });

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
//   createCustomerReceipt,
//   getCustomerReceipts,
//   getCustomerReceiptByNumber,
//   getUnpaidSalesInvoices,
//   getReceiptLedgers,
// };

const customerReceiptService = require("./customerReceipt.service");

const getContext = (req) => ({
  tenant: req.tenant,
  userId: req.user.userId,
  ipAddress: req.ip,
});

const createCustomerReceipt = async (req, res, next) => {
  try {
    const result = await customerReceiptService.createCustomerReceipt({
      ...getContext(req),
      payload: req.body,
    });

    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      message: result.replayed
        ? "This customer receipt was already recorded"
        : "Customer receipt recorded successfully",
      replayed: result.replayed,
      receipt: result.receipt,
    });
  } catch (error) {
    next(error);
  }
};

const getCustomerReceipts = async (req, res, next) => {
  try {
    const result = await customerReceiptService.getCustomerReceipts({
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

const getCustomerReceiptByNumber = async (req, res, next) => {
  try {
    const receipt = await customerReceiptService.getCustomerReceiptByNumber({
      tenant: req.tenant,
      receiptNumber:
        req.validatedParams?.receiptNumber || req.params.receiptNumber,
    });

    return res.status(200).json({
      success: true,
      receipt,
    });
  } catch (error) {
    next(error);
  }
};

const getUnpaidSalesInvoices = async (req, res, next) => {
  try {
    const result = await customerReceiptService.getUnpaidSalesInvoices({
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

const getReceiptLedgers = async (req, res, next) => {
  try {
    const ledgers = await customerReceiptService.getReceiptLedgers({
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
  createCustomerReceipt,
  getCustomerReceipts,
  getCustomerReceiptByNumber,
  getUnpaidSalesInvoices,
  getReceiptLedgers,
};